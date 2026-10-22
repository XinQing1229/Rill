import { executionContext } from './execution-context.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { ArtifactStatus, PipelineMode, QuestionnaireAnswers, Stage } from '@rill/shared';
import { PrismaService } from '../prisma.service.js';
import { profileFor, stagesFor } from '../genre/genre-profile.js';
import {
  MissingRequiredAnswersError,
  QuestionnaireService,
} from '../questionnaire/questionnaire.js';
import { ArtifactRegistry } from './artifact.registry.js';
import { UpstreamAssembler } from './upstream.assembler.js';
import { compilePipelineGraph, PipelineState, StageRunner } from './pipeline.graph.js';
import { createStageRunner, markDownstreamStale, setStageStatus } from './stage.runner.js';
import { createCheckpointer } from './checkpointer.js';

export interface CreateProjectInput {
  title: string;
  answers: QuestionnaireAnswers;
  mode?: PipelineMode;
}

/**
 * 后台生成的总体超时。模型自身有单次请求超时，但图执行级别的挂起
 * （如连接半开）不会抛错，需要这层兜底把项目从 running 中解救出来。
 */
const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;

const TIMEOUT_MARK = Symbol('generation-timeout');

/** 确认入口的动作：继续推进 / 重新生成当前阶段 */
export type ConfirmAction = 'confirm' | 'regenerate';

@Injectable()
export class PipelineService implements OnModuleInit {
  private readonly logger = new Logger(PipelineService.name);
  /** 可被测试覆盖，以便用极小值验证超时路径 */
  private readonly generationTimeoutMs: number = GENERATION_TIMEOUT_MS;
  private readonly runner: StageRunner;
  private checkpointer!: SqliteSaver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly questionnaire: QuestionnaireService,
    private readonly artifacts: ArtifactRegistry,
    private readonly assembler: UpstreamAssembler,
    private readonly config: ConfigService,
  ) {
    this.runner = createStageRunner({ prisma, assembler, artifacts });
  }

  async onModuleInit(): Promise<void> {
    await this.prisma.stageRun.updateMany({
      where: { status: 'generating' },
      data: { status: 'failed', error: '服务重启中断了生成，请重试' },
    });
    // 释放被中断的运行锁：执行进度仍保留在 checkpointer，再次触发即从中断处继续
    const result = await this.prisma.project.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', runId: null },
    });
    if (result.count > 0) {
      this.logger.warn(
        `重启时释放了 ${result.count} 个被中断的生成任务（进度保留在 checkpoint，可续跑）`,
      );
    }
    this.checkpointer = createCheckpointer(
      this.config.get<string>('pipeline.checkpointFile') ?? 'file:./checkpoints.db',
    );
  }

  async create(input: CreateProjectInput) {
    try {
      this.questionnaire.validate(input.answers);
    } catch (error) {
      if (error instanceof MissingRequiredAnswersError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    const stages = stagesFor(input.answers.genre);

    return this.prisma.project.create({
      data: {
        title: input.title,
        genre: input.answers.genre,
        length: input.answers.length,
        mode: input.mode ?? 'manual',
        currentStage: stages[0],
        status: 'idle',
        answers: JSON.stringify(input.answers),
        premise: { create: { data: '{}', status: 'pending' } },
      },
    });
  }

  async get(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        premise: true,
        world: true,
        characters: true,
        relations: true,
        stageRuns: { orderBy: { updatedAt: 'desc' } },
      },
    });
    if (!project) throw new NotFoundException(`项目不存在: ${id}`);
    // 附加该类型的完整阶段列表：前端时间轴与上游判断共用一份事实来源
    return {
      ...project,
      stageStates: Object.fromEntries(
        stagesFor(project.genre as QuestionnaireAnswers['genre']).map((stage) => {
          const state = this.assembler.readStageState(project, stage);
          const execution = project.stageRuns.find((run) => run.stage === stage);
          return [
            stage,
            state
              ? {
                  ...state,
                  error: execution?.error ?? null,
                  confirmedAt: execution?.confirmedAt ?? null,
                }
              : {
                  status:
                    project.status === 'failed' && project.currentStage === stage
                      ? 'failed'
                      : 'pending',
                  stale: false,
                  error:
                    project.status === 'failed' && project.currentStage === stage
                      ? '此前生成被中断，请重试'
                      : null,
                  confirmedAt: null,
                },
          ];
        }),
      ),
      stages: stagesFor(project.genre as QuestionnaireAnswers['genre']),
    };
  }

  /** 项目列表（列表页用，按更新时间倒序） */
  async list() {
    return this.prisma.project.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        genre: true,
        length: true,
        mode: true,
        currentStage: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * 触发生成：立即返回（阶段进入 generating），生成在后台由图推进。
   * 已有执行快照时从中断处恢复，否则以当前阶段为起点启动。
   */
  async generate(
    id: string,
    options: { force?: boolean; wait?: boolean; autoChain?: boolean } = {},
  ) {
    const project = await this.get(id);
    const stage = project.currentStage as Stage;
    const answers = JSON.parse(project.answers) as QuestionnaireAnswers;

    if (project.status === 'running') {
      throw new ConflictException('该项目有生成任务正在进行，请勿重复触发');
    }

    const artifactState = this.assembler.readStageState(project, stage);
    // 已生效（完成且未失效）的产物不重复生成
    if (artifactState?.status === 'done' && !artifactState.stale && !options.force) {
      return { stage, status: artifactState.status, started: false };
    }

    const runId = await this.acquireRun(project);
    try {
      if (options.force) {
        // 打破幂等，使该阶段重新生成（下游失效由节点内统一处理）；
        // 同时清除中断点，否则会恢复到下一阶段而不是重跑本阶段
        await this.artifacts.setStale(stage, id, true);
        await this.checkpointer.deleteThread(id);
      }
    } catch (error) {
      await this.prisma.project.updateMany({
        where: { id, runId },
        data: { status: 'failed', runId: null },
      });
      throw error;
    }

    const task = this.runGraph(id, answers, project.mode as PipelineMode, stage).finally(() =>
      this.releaseRun(id, runId),
    );
    if (options.wait) {
      await task;
    } else {
      void task.catch(() => undefined);
    }

    return {
      stage,
      status: 'generating' as ArtifactStatus,
      started: true,
      auto: project.mode === 'auto',
    };
  }

  /** 手动模式：确认当前阶段后恢复图，推进到下一阶段 */
  async confirm(id: string, action: ConfirmAction = 'confirm') {
    const project = await this.get(id);
    const stage = project.currentStage as Stage;

    const state = this.assembler.readStageState(project, stage);
    if (!state || state.status !== 'done') {
      throw new BadRequestException('当前阶段产物尚未生成完成，无法确认');
    }
    if (state.stale) {
      throw new BadRequestException('当前阶段产物已失效，请先重新生成后再确认');
    }

    if (project.status === 'running') {
      throw new ConflictException('该项目有生成任务正在进行，请勿重复触发');
    }

    const runId = await this.acquireRun(project);
    try {
      if (action === 'regenerate') {
        // 重新生成：使本阶段失效，并清除中断点，使图从本阶段重新开始
        await this.artifacts.setStale(stage, id, true);
        await this.checkpointer.deleteThread(id);
      }

      if (action === 'confirm')
        await this.prisma.stageRun.updateMany({
          where: { projectId: id, stage, stale: false, status: 'done' },
          data: { confirmedAt: new Date() },
        });
      const answers = JSON.parse(project.answers) as QuestionnaireAnswers;
      let startStage = stage;
      if (
        action === 'confirm' &&
        !(await this.checkpointer.getTuple({ configurable: { thread_id: id } }))
      ) {
        const stages = stagesFor(answers.genre);
        const next = stages[stages.indexOf(stage) + 1];
        if (!next) {
          await this.prisma.project.update({ where: { id }, data: { status: 'done' } });
          return this.get(id);
        }
        startStage = next;
      }
      await this.runGraph(id, answers, project.mode as PipelineMode, startStage);
      return this.get(id);
    } finally {
      await this.releaseRun(id, runId);
    }
  }

  /** 回退到指定阶段，并把其之后的阶段产物标记为失效 */
  async rollback(id: string, stage: Stage) {
    const project = await this.get(id);
    const stages = stagesFor(project.genre as QuestionnaireAnswers['genre']);
    if (!stages.includes(stage)) {
      throw new BadRequestException(`该类型不支持阶段: ${stage}`);
    }

    if (project.status === 'running') throw new ConflictException('项目正在运行，请稍后回退');
    const target = this.assembler.readStageState(project, stage);
    if (target?.status !== 'done') throw new BadRequestException('只能回退到已完成阶段');

    const runId = await this.acquireRun(project);
    try {
      await markDownstreamStale(
        this.artifacts,
        id,
        stage,
        project.genre as QuestionnaireAnswers['genre'],
      );
      // 清除执行快照，使下次启动从入口路由按新的 currentStage 开始
      await this.checkpointer.deleteThread(id);
      await this.prisma.project.update({
        where: { id },
        data: { currentStage: stage, status: 'idle' },
      });
      return this.get(id);
    } finally {
      await this.releaseRun(id, runId);
    }
  }

  async setMode(id: string, mode: PipelineMode) {
    const project = await this.get(id);
    const result = await this.prisma.project.updateMany({
      where: { id, status: { not: 'running' }, runId: null, updatedAt: project.updatedAt },
      data: { mode },
    });
    if (result.count !== 1) throw new ConflictException('项目正在运行或已变更，请刷新后重试');
    return this.get(id);
  }

  /** 查询项目的人物列表（含状态） */
  async characters(id: string) {
    await this.get(id);
    return this.prisma.character.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 查询项目的关系列表（含双方标识、类型与相对角色） */
  async relations(id: string) {
    await this.get(id);
    return this.prisma.relation.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 自动模式：无中断地连续推进；失败停在该阶段，
   * 再次启动从 checkpointer 记录的中断处继续。
   */
  async runAuto(id: string) {
    await this.generate(id, { autoChain: true, wait: true });
    return this.get(id);
  }

  /** 所有改变执行位置的入口都必须原子领取运行权。 */
  private async acquireRun(project: { id: string; updatedAt: Date }): Promise<string> {
    const runId = randomUUID();
    const result = await this.prisma.project.updateMany({
      where: {
        id: project.id,
        updatedAt: project.updatedAt,
        status: { not: 'running' },
        runId: null,
      },
      data: { status: 'running', runId },
    });
    if (result.count !== 1) throw new ConflictException('项目正在运行或已变更，请刷新后重试');
    return runId;
  }

  private async releaseRun(id: string, runId: string): Promise<void> {
    await this.prisma.project.updateMany({
      where: { id, runId, status: 'running' },
      data: { status: 'failed' },
    });
    await this.prisma.project.updateMany({ where: { id, runId }, data: { runId: null } });
  }

  /**
   * 执行图：已有快照则恢复（input 为 null），否则以 currentStage 为起点启动。
   * 外层保留总体超时兜底，避免后台任务挂起导致项目永久停在 running。
   */
  private async runGraph(
    id: string,
    answers: QuestionnaireAnswers,
    mode: PipelineMode,
    fallbackStage: Stage,
  ): Promise<void> {
    const owner = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const runId = owner.runId!;
    const controller = new AbortController();
    const stages = stagesFor(answers.genre);
    const graph = compilePipelineGraph({
      stages,
      runner: this.runner,
      checkpointer: new Proxy(this.checkpointer, {
        get: (target, property) => {
          const method = Reflect.get(target, property);
          if (property === 'put' || property === 'putWrites') {
            return async (...args: unknown[]) => {
              controller.signal.throwIfAborted();
              const current = await this.prisma.project.findUnique({ where: { id } });
              if (current?.runId !== runId || current.status !== 'running')
                throw new Error('运行已失效，拒绝写入快照');
              controller.signal.throwIfAborted();
              return Reflect.apply(method, target, args);
            };
          }
          return typeof method === 'function' ? method.bind(target) : method;
        },
      }),
      mode,
      skipStages: profileFor(answers.genre).skipStages,
    });
    const config = { configurable: { thread_id: id } };

    const existing = await this.checkpointer.getTuple(config);
    const input: PipelineState | null = existing
      ? null
      : { projectId: id, genre: answers.genre, mode, currentStage: fallbackStage, answers };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMEOUT_MARK>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT_MARK), this.generationTimeoutMs);
      // 不因定时器未决而阻止进程退出
      timer.unref?.();
    });

    try {
      const outcome = await Promise.race([
        executionContext
          .run({ projectId: id, runId, signal: controller.signal }, () =>
            graph.invoke(input, { ...config, signal: controller.signal }),
          )
          .then((state) => ({ kind: 'state' as const, state })),
        timeout,
      ]);

      if (outcome === TIMEOUT_MARK) {
        controller.abort();
        const message = `生成超时（超过 ${Math.round(this.generationTimeoutMs / 60000)} 分钟），已中止并标记失败`;
        await this.failProject(id, fallbackStage, message);
        throw new Error(message);
      }

      // 同步执行进度（冗余写入，便于查询与前端展示）
      await this.prisma.project.updateMany({
        where: { id, runId },
        data: {
          currentStage: outcome.state.currentStage ?? fallbackStage,
          status: outcome.state.currentStage === stages.at(-1) ? 'done' : 'idle',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failProject(id, fallbackStage, message);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 标记项目失败。若阶段产物还停在 generating（如超时中断），补记为 failed；
   * 已由 runner 标记为 failed 的不再覆盖，避免误伤已完成阶段。
   */
  private async failProject(id: string, fallbackStage: Stage, message?: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        premise: true,
        world: true,
        characters: true,
        relations: true,
        stageRuns: { orderBy: { updatedAt: 'desc' } },
      },
    });
    if (!project) return;
    const stage = (project.currentStage ?? fallbackStage) as Stage;
    if (message) {
      const state = this.assembler.readStageState(project, stage);
      if (state?.status !== 'failed') {
        await setStageStatus(this.prisma, id, stage, 'failed', message);
      }
    }
    await this.prisma.project.update({ where: { id }, data: { status: 'failed' } });
  }
}
