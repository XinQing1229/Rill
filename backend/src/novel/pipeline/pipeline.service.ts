import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
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
    // 释放被中断的运行锁：执行进度仍保留在 checkpointer，再次触发即从中断处继续
    const result = await this.prisma.project.updateMany({
      where: { status: 'running' },
      data: { status: 'failed' },
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
      include: { premise: true, world: true, characters: true, relations: true },
    });
    if (!project) throw new NotFoundException(`项目不存在: ${id}`);
    // 附加该类型的完整阶段列表：前端时间轴与上游判断共用一份事实来源
    return {
      ...project,
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

    // 自动模式且项目空闲/失败（失败续跑）：后台启动连续推进
    if (
      project.mode === 'auto' &&
      !options.autoChain &&
      ['idle', 'failed'].includes(project.status)
    ) {
      void this.runAuto(id).catch(() => undefined);
      return {
        stage,
        status: 'generating' as ArtifactStatus,
        started: true,
        auto: true,
      };
    }

    if (project.status === 'running') {
      throw new ConflictException('该项目有生成任务正在进行，请勿重复触发');
    }

    const artifactState = this.assembler.readStageState(project, stage);
    // 已生效（完成且未失效）的产物不重复生成
    if (artifactState?.status === 'done' && !artifactState.stale && !options.force) {
      return { stage, status: artifactState.status, started: false };
    }

    if (options.force) {
      // 打破幂等，使该阶段重新生成（下游失效由节点内统一处理）；
      // 同时清除中断点，否则会恢复到下一阶段而不是重跑本阶段
      await this.artifacts.setStale(stage, id, true);
      await this.checkpointer.deleteThread(id);
    }

    await this.prisma.project.update({ where: { id }, data: { status: 'running' } });

    const task = this.runGraph(id, answers, project.mode as PipelineMode, stage);
    if (options.wait) {
      await task;
    } else {
      void task.catch(() => undefined);
    }

    return { stage, status: 'generating' as ArtifactStatus, started: true };
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

    if (action === 'regenerate') {
      // 重新生成：使本阶段失效，并清除中断点，使图从本阶段重新开始
      await this.artifacts.setStale(stage, id, true);
      await this.checkpointer.deleteThread(id);
    }

    const answers = JSON.parse(project.answers) as QuestionnaireAnswers;
    await this.prisma.project.update({ where: { id }, data: { status: 'running' } });

    await this.runGraph(id, answers, project.mode as PipelineMode, stage);
    return this.get(id);
  }

  /** 回退到指定阶段，并把其之后的阶段产物标记为失效 */
  async rollback(id: string, stage: Stage) {
    const project = await this.get(id);
    const stages = stagesFor(project.genre as QuestionnaireAnswers['genre']);
    if (!stages.includes(stage)) {
      throw new BadRequestException(`该类型不支持阶段: ${stage}`);
    }

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
  }

  async setMode(id: string, mode: PipelineMode) {
    await this.get(id);
    await this.prisma.project.update({ where: { id }, data: { mode } });
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
    const project = await this.get(id);
    const answers = JSON.parse(project.answers) as QuestionnaireAnswers;

    await this.prisma.project.update({ where: { id }, data: { status: 'running' } });
    try {
      await this.runGraph(id, answers, 'auto', project.currentStage as Stage);
    } catch (error) {
      await this.prisma.project.update({ where: { id }, data: { status: 'failed' } });
      throw error;
    }
    return this.get(id);
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
    const stages = stagesFor(answers.genre);
    const graph = compilePipelineGraph({
      stages,
      runner: this.runner,
      checkpointer: this.checkpointer,
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
        graph.invoke(input, config).then((state) => ({ kind: 'state' as const, state })),
        timeout,
      ]);

      if (outcome === TIMEOUT_MARK) {
        const message = `生成超时（超过 ${Math.round(this.generationTimeoutMs / 60000)} 分钟），已中止并标记失败`;
        await this.failProject(id, fallbackStage, message);
        throw new Error(message);
      }

      // 同步执行进度（冗余写入，便于查询与前端展示）
      await this.prisma.project.update({
        where: { id },
        data: { currentStage: outcome.state.currentStage ?? fallbackStage, status: 'idle' },
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
      include: { premise: true, world: true, characters: true, relations: true },
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
