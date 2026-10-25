import {
  migratePipeline,
  versionedCheckpointer,
  discardLegacyCheckpoint,
} from './pipeline-compatibility.js';
import { acquireProjectRun } from './project-run.js';
import { BookExportService } from '../book-export/book-export.service.js';
import { ProseService } from '../prose/prose.service.js';
import { Command } from '@langchain/langgraph';
import { OutlineService } from '../outline/outline.service.js';
import type { OutlineConfirm } from '@rill/shared';
import { executionContext } from './execution-context.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import {
  ArtifactStatus,
  DEFAULT_WRITING_STYLE,
  CreateProjectSchema,
  QUESTIONNAIRE_VERSION,
  PipelineMode,
  ProjectScope,
  QuestionnaireAnswers,
  Stage,
} from '@rill/shared';
import { PrismaService } from '../prisma.service.js';
import { profileFor, stagesFor } from '../genre/genre-profile.js';
import {
  MissingRequiredAnswersError,
  QuestionnaireService,
} from '../questionnaire/questionnaire.js';
import { ArtifactRegistry } from './artifact.registry.js';
import { UpstreamAssembler } from './upstream.assembler.js';
import {
  compilePipelineGraph,
  PipelineState,
  StageRunner,
  type PipelineNode,
} from './pipeline.graph.js';
import { createStageRunner, markDownstreamStale } from './stage.runner.js';
import { createCheckpointer, deleteCheckpointThread } from './checkpointer.js';

export interface CreateProjectInput {
  title?: string;
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

/** 取流程顺序更靠后的阶段；不在阶段列表中的取值视为无效并忽略 */
function laterStage(a: Stage, b: Stage | undefined, stages: Stage[]): Stage {
  if (!b || !stages.includes(b)) return a;
  if (!stages.includes(a)) return b;
  return stages.indexOf(b) > stages.indexOf(a) ? b : a;
}

/**
 * 可见性条件：回收站中的项目（`deletedAt` 非空）对所有默认读路径不可见。
 * 所有面向创作的读写都必须带上它，避免恢复前读到或修改已删除项目的数据。
 */
const VISIBLE_PROJECT = { deletedAt: null };

@Injectable()
export class PipelineService implements OnModuleInit, OnModuleDestroy {
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
    @Optional() private readonly outline?: OutlineService,
    @Optional() private readonly prose?: ProseService,
    @Optional() private readonly bookExport?: BookExportService,
  ) {
    this.runner = createStageRunner({ prisma, assembler, artifacts });
  }

  async onModuleInit(): Promise<void> {
    const interruptedDeletions = await this.prisma.proseDeletion.findMany({
      select: { projectId: true },
    });
    if (interruptedDeletions.length)
      await this.prisma.project.updateMany({
        where: {
          id: { in: interruptedDeletions.map((entry) => entry.projectId) },
          deletedAt: { not: null },
          status: 'running',
        },
        data: { runId: null, status: 'failed' },
      });

    await this.prisma.stageRun.updateMany({
      // 回收站项目冻结：不参与重启时的中断清理
      where: { status: 'generating', project: VISIBLE_PROJECT },
      data: { status: 'failed', error: '服务重启中断了生成，请重试' },
    });
    // 种子预览不属于创作阶段：重启后恢复预览前状态，不污染原阶段。
    const previews = await this.prisma.premiseRevision.findMany({
      where: { status: 'generating', project: VISIBLE_PROJECT },
    });
    for (const preview of previews) {
      await this.prisma.$transaction(async (tx) => {
        await tx.project.updateMany({
          where: { id: preview.projectId, runId: preview.runId, ...VISIBLE_PROJECT },
          data: { status: preview.originalStatus, runId: null },
        });
        await tx.premiseRevision.update({
          where: { id: preview.id },
          data: { status: 'failed', error: '服务重启中断了修改预览，请重试' },
        });
      });
    }
    // 释放被中断的运行锁：执行进度仍保留在 checkpointer，再次触发即从中断处继续
    const result = await this.prisma.project.updateMany({
      where: { status: 'running', ...VISIBLE_PROJECT },
      data: { status: 'failed', runId: null },
    });
    if (result.count > 0) {
      this.logger.warn(
        `重启时释放了 ${result.count} 个被中断的生成任务（进度保留在 checkpoint，可续跑）`,
      );
    }
    this.checkpointer?.db.close();
    this.checkpointer = versionedCheckpointer(
      createCheckpointer(
        this.config.get<string>('pipeline.checkpointFile') ?? 'file:./checkpoints.db',
      ),
    );
    await migratePipeline(this.prisma, this.checkpointer);
  }

  onModuleDestroy(): void {
    this.checkpointer?.db.close();
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
    const parsed = CreateProjectSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message ?? '问卷答案无效');
    const answers = parsed.data.answers;
    const extras = { ...answers.extras };
    delete extras.relation;
    const normalized: QuestionnaireAnswers = {
      ...answers,
      writingStyle: answers.writingStyle ?? { ...DEFAULT_WRITING_STYLE },
      extras: Object.keys(extras).length ? extras : undefined,
    };
    const stages = stagesFor(answers.genre);

    return this.prisma.project.create({
      data: {
        title: parsed.data.title ?? '未命名作品',
        titleSource: parsed.data.title ? 'author' : 'placeholder',
        genre: input.answers.genre,
        length: input.answers.length,
        mode: input.mode ?? 'manual',
        currentStage: stages[0],
        status: 'idle',
        answers: JSON.stringify(normalized),
        questionnaireVersion: QUESTIONNAIRE_VERSION,
        premise: { create: { data: '{}', status: 'pending' } },
      },
    });
  }

  async get(id: string) {
    await this.prose?.reconcile(id);
    // 回收站中的项目按「不可见」处理：findFirst + 可见性条件而非 findUnique
    const project = await this.prisma.project.findFirst({
      where: { id, ...VISIBLE_PROJECT },
      include: {
        proseBook: { include: { chapters: true } },
        premise: true,
        world: true,
        characters: true,
        relations: true,
        stageRuns: { orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }] },
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
      outlineProgress: (await this.outline?.progress(id)) ?? null,
      stages: stagesFor(project.genre as QuestionnaireAnswers['genre']),
    };
  }

  /** 项目列表（列表页用）：默认按更新时间倒序，回收站按删除时间倒序 */
  async list(scope: ProjectScope = 'active') {
    const trash = scope === 'trash';
    return this.prisma.project.findMany({
      where: trash ? { deletedAt: { not: null } } : VISIBLE_PROJECT,
      orderBy: trash ? { deletedAt: 'desc' } : { updatedAt: 'desc' },
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
        deletedAt: true,
      },
    });
  }

  /**
   * 软删除：仅标记删除时刻，产物、阶段状态与问答保持不变。
   * 单次写入判定三态：不存在/已删除为 404，运行中（可能与删除并发）为 409。
   */
  async softDelete(id: string) {
    const marked = await this.prisma.project.updateMany({
      where: { id, deletedAt: null, status: { not: 'running' }, runId: null },
      data: { deletedAt: new Date() },
    });
    if (marked.count !== 1) {
      const existing = await this.prisma.project.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) throw new NotFoundException(`项目不存在: ${id}`);
      throw new ConflictException('项目正在生成，请稍后删除');
    }
    await this.bookExport?.pauseProject(id);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id },
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
        deletedAt: true,
      },
    });
    return project;
  }

  /** 从回收站恢复：清空删除时刻，项目连同产物与进度回到创作列表 */
  async restore(id: string) {
    await this.prisma.$transaction(async (tx) => {
      if (await tx.proseDeletion.findUnique({ where: { projectId: id } }))
        throw new ConflictException('项目正在永久删除或等待清理重试，无法恢复');
      const restored = await tx.project.updateMany({
        where: { id, deletedAt: { not: null }, runId: null, status: { not: 'running' } },
        data: { deletedAt: null },
      });
      if (restored.count !== 1) {
        const project = await tx.project.findUnique({ where: { id } });
        if (project?.deletedAt) throw new ConflictException('项目正在清理，请稍后重试');
        throw new NotFoundException(`回收站中不存在该项目: ${id}`);
      }
    });
    await this.prose?.reconcile(id);
    await this.bookExport?.resumeProject(id);
    return this.get(id);
  }

  /** 永久删除单个回收站项目：级联产物 + 独立用量记录 + 流水线快照 */
  async purge(id: string) {
    const target = await this.prisma.project.findUnique({
      where: { id },
      select: { deletedAt: true },
    });
    if (!target?.deletedAt) throw new NotFoundException(`回收站中不存在该项目: ${id}`);
    await this.purgeProject(id);
    return { id, purged: true };
  }

  /** 清空回收站：逐个永久删除，返回清理数量 */
  async clearTrash() {
    const targets = await this.prisma.project.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true },
    });
    for (const target of targets) {
      await this.purgeProject(target.id);
    }
    return { removed: targets.length };
  }

  /** 物理清理：Prisma 部分在事务内，checkpoint 在独立 SQLite，失败仅告警 */
  private async purgeProject(id: string): Promise<void> {
    const deletionRunId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const acquired = await tx.project.updateMany({
        where: { id, deletedAt: { not: null }, runId: null, status: { not: 'running' } },
        data: { runId: deletionRunId, status: 'running' },
      });
      if (acquired.count !== 1) {
        const project = await tx.project.findUnique({ where: { id } });
        if (!project?.deletedAt) throw new NotFoundException(`回收站中不存在该项目: ${id}`);
        throw new ConflictException('项目正在永久删除，请勿重复触发');
      }
      await tx.proseDeletion.upsert({
        where: { projectId: id },
        create: { projectId: id },
        update: { error: null },
      });
    });
    try {
      await this.bookExport?.pauseProject(id);
      if (this.prose) {
        await this.prose.files.purge(id);
        await deleteCheckpointThread(this.checkpointer, id);
      }
      await this.prisma.$transaction(async (tx) => {
        const owned = await tx.project.findFirst({
          where: { id, runId: deletionRunId, deletedAt: { not: null } },
        });
        if (!owned) throw new ConflictException('永久删除执行权已变化');
        await tx.outlineUsage.deleteMany({ where: { projectId: id } });
        await tx.beatUsage.deleteMany({ where: { projectId: id } });
        await tx.project.delete({ where: { id } });
        await tx.proseDeletion.deleteMany({ where: { projectId: id } });
      });
      if (!this.prose) {
        try {
          await deleteCheckpointThread(this.checkpointer, id);
        } catch {
          this.logger.warn(`项目 ${id} 的流水线快照清理失败`);
        }
      }
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await tx.proseDeletion.updateMany({
          where: { projectId: id },
          data: { error: error instanceof Error ? error.message : '清理失败' },
        });
        await tx.project.updateMany({
          where: { id, runId: deletionRunId },
          data: { runId: null, status: 'failed' },
        });
      });
      throw error;
    }
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
    if (stage === 'prose' && options.force)
      throw new BadRequestException('正文请使用单章候选重生成，避免覆盖作者内容');
    const answers = JSON.parse(project.answers) as QuestionnaireAnswers;
    this.questionnaire.validate(answers);

    if (project.status === 'running') {
      throw new ConflictException('该项目有生成任务正在进行，请勿重复触发');
    }

    const artifactState = this.assembler.readStageState(project, stage);
    // 已生效（完成且未失效）的产物不重复生成
    if (
      stage !== 'outline' &&
      stage !== 'prose' &&
      artifactState?.status === 'done' &&
      !artifactState.stale &&
      !options.force
    ) {
      return { stage, status: artifactState.status, started: false };
    }

    const runId = await this.acquireRun(project);
    try {
      if (options.force) {
        // 打破幂等，使该阶段重新生成（下游失效由节点内统一处理）；
        // 同时清除中断点，否则会恢复到下一阶段而不是重跑本阶段
        await this.artifacts.setStale(stage, id, true);
        await deleteCheckpointThread(this.checkpointer, id);
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
  async confirm(id: string, action: ConfirmAction = 'confirm', confirmation?: OutlineConfirm) {
    const project = await this.get(id);
    const stage = project.currentStage as Stage;
    if (stage === 'prose') throw new BadRequestException('正文必须使用逐章接受接口');
    let effectiveAction = action;
    if (confirmation || (stage === 'outline' && action === 'confirm' && this.outline)) {
      if (!confirmation || !this.outline)
        throw new BadRequestException('大纲确认必须指定目标和内容版本');
      const decision = await this.outline.checkConfirm(id, confirmation);
      // 幂等重复确认：内容已按当前版本确认且流程已离开大纲，不重复派发模型请求
      if (decision === 'skip') return this.get(id);
      if (decision === 'commit') {
        if (stage !== 'outline') throw new BadRequestException('请先回退到大纲阶段');
        const runId = await this.acquireRun(project);
        try {
          await this.runGraph(
            id,
            JSON.parse(project.answers),
            project.mode as PipelineMode,
            'outline',
            confirmation,
          );
          return this.get(id);
        } finally {
          await this.releaseRun(id, runId);
        }
      }
      // decision === 'advance'：大纲内容已是当前最终确认版本，且仍停留在大纲阶段
      // （作者回退后未修改即确认）。沿用既有“回退后一次确认即推进”语义：
      // 不重跑大纲，直接从下一阶段继续推进。
      effectiveAction = 'confirm';
    }

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
      await discardLegacyCheckpoint(this.checkpointer, id);
      if (effectiveAction === 'regenerate') {
        // 重新生成：使本阶段失效，并清除中断点，使图从本阶段重新开始
        await this.artifacts.setStale(stage, id, true);
        await deleteCheckpointThread(this.checkpointer, id);
      }

      if (effectiveAction === 'confirm')
        await this.prisma.stageRun.updateMany({
          where: { projectId: id, stage, stale: false, status: 'done' },
          data: { confirmedAt: new Date() },
        });
      const answers = JSON.parse(project.answers) as QuestionnaireAnswers;
      this.questionnaire.validate(answers);
      let startStage: Stage = stage;
      if (
        effectiveAction === 'confirm' &&
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

  async proseAction(
    id: string,
    action: (prose: ProseService) => Promise<void | boolean>,
    advance = false,
  ) {
    if (!this.prose) throw new BadRequestException('正文能力未注册');
    const project = await this.get(id);
    if (project.currentStage !== 'prose') throw new BadRequestException('请先进入正文阶段');
    const runId = await this.acquireRun(project);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = Math.max(
      this.generationTimeoutMs,
      3 *
        (this.config.get<number>('llm.budget.maxCallsPerRequest') ?? 6) *
        Math.max(
          this.config.get<number>('llm.usages.draft.timeout') ?? 60000,
          this.config.get<number>('llm.usages.reasoning.timeout') ?? 60000,
        ) +
        180000,
    );
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('正文操作超时，请重试'));
      }, timeoutMs);
    });
    try {
      await this.prisma.stageRun.create({
        data: { projectId: id, runId, stage: 'prose', status: 'generating' },
      });
      const result = await Promise.race([
        executionContext.run({ projectId: id, runId, signal: controller.signal }, () =>
          action(this.prose!),
        ),
        deadline,
      ]);
      if (result === false) {
        await this.prisma.stageRun.deleteMany({ where: { projectId: id, runId, stage: 'prose' } });
        await this.prisma.project.updateMany({
          where: { id, runId },
          data: { status: project.status },
        });
        return this.prose.detail(id);
      }
      if (advance)
        await this.runGraph(id, JSON.parse(project.answers), project.mode as PipelineMode, 'prose');
      else {
        await this.prisma.stageRun.updateMany({
          where: { projectId: id, runId, stage: 'prose' },
          data: { status: 'pending' },
        });
        await this.prisma.project.updateMany({ where: { id, runId }, data: { status: 'idle' } });
      }
      return this.prose.detail(id);
    } catch (error) {
      await this.failProject(
        id,
        'prose',
        error instanceof Error ? error.message : '正文操作失败',
        runId,
      );
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
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
      await deleteCheckpointThread(this.checkpointer, id);
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
      where: {
        id,
        ...VISIBLE_PROJECT,
        status: { not: 'running' },
        runId: null,
        updatedAt: project.updatedAt,
      },
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
    return acquireProjectRun(this.prisma, project);
  }

  /** 种子候选采用持有执行权时，先清理旧的下游恢复点。 */
  async clearPremiseCheckpoint(id: string): Promise<void> {
    await deleteCheckpointThread(this.checkpointer, id);
  }

  /** 释放运行权：项目已进入回收站时不再改写其状态，保持删除时刻的数据冻结 */
  private async releaseRun(id: string, runId: string): Promise<void> {
    await this.prisma.project.updateMany({
      where: { id, runId, ...VISIBLE_PROJECT, status: 'running' },
      data: { status: 'failed' },
    });
    await this.prisma.project.updateMany({
      where: { id, runId, ...VISIBLE_PROJECT },
      data: { runId: null },
    });
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
    confirmation?: OutlineConfirm,
  ): Promise<void> {
    this.questionnaire.validate(answers);
    const owner = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    // 删除先于本次执行落地：直接中断，避免把结果写回回收站中的项目
    if (owner.deletedAt) throw new Error('项目已进入回收站，已中止生成');
    const runId = owner.runId!;
    const controller = new AbortController();
    const stages = stagesFor(answers.genre);
    const graph = compilePipelineGraph({
      stages,
      runner: this.runner,
      outlineNodes: this.outline?.nodes,
      proseNode: this.prose?.node,
      checkpointer: new Proxy(this.checkpointer, {
        get: (target, property) => {
          const method = Reflect.get(target, property);
          if (property === 'put' || property === 'putWrites') {
            return async (...args: unknown[]) => {
              controller.signal.throwIfAborted();
              const current = await this.prisma.project.findUnique({ where: { id } });
              if (
                current?.runId !== runId ||
                current.status !== 'running' ||
                current.deletedAt !== null
              )
                throw new Error('运行已失效或项目已进入回收站，拒绝写入快照');
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

    await discardLegacyCheckpoint(this.checkpointer, id);
    if (fallbackStage === 'prose' && this.prose)
      await deleteCheckpointThread(this.checkpointer, id);
    let existing = await this.checkpointer.getTuple(config);
    let resume = confirmation;
    if (fallbackStage === 'outline' && this.outline) {
      const detail = await this.outline.get(id);
      const snapshot = existing ? await graph.getState(config, { subgraphs: true }) : null;
      const interrupts: Array<{ target?: string }> = [];
      const collect = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        const item = value as {
          interrupts?: Array<{ value?: { target?: string } }>;
          tasks?: unknown[];
          state?: unknown;
        };
        for (const entry of item.interrupts ?? []) if (entry.value) interrupts.push(entry.value);
        for (const task of item.tasks ?? []) collect(task);
        if (item.state) collect(item.state);
      };
      collect(snapshot);
      const target =
        detail.step === 'plan_review'
          ? 'outline-plan'
          : detail.step === 'outline_review'
            ? 'outline'
            : null;
      if (confirmation && !interrupts.some((i) => i.target === confirmation.target)) {
        // 编辑导致旧暂停点不再适用；持运行权确认业务版本，再按持久化步骤重建当前大纲。
        await executionContext.run({ projectId: id, runId, signal: controller.signal }, () =>
          this.outline!.acceptConfirmation(id, confirmation.target, confirmation.expectedRevision),
        );
        await deleteCheckpointThread(this.checkpointer, id);
        existing = undefined;
        resume = undefined;
      } else if (
        !confirmation &&
        existing &&
        (detail.step === 'planning' ||
          detail.stale ||
          (target && !interrupts.some((i) => i.target === target)))
      ) {
        await deleteCheckpointThread(this.checkpointer, id);
        existing = undefined;
      }
    }
    const input =
      resume && existing
        ? new Command<OutlineConfirm, Partial<PipelineState>, PipelineNode>({ resume })
        : existing
          ? null
          : { projectId: id, genre: answers.genre, mode, currentStage: fallbackStage, answers };

    let timeoutMs = this.generationTimeoutMs;
    if (this.prose) {
      const requestMs = Math.max(
        this.config.get<number>('llm.usages.draft.timeout') ?? 60000,
        this.config.get<number>('llm.usages.reasoning.timeout') ?? 60000,
      );
      const calls = this.config.get<number>('llm.budget.maxCallsPerRequest') ?? 6;
      timeoutMs = Math.max(timeoutMs, 3 * requestMs * calls + 180000);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMEOUT_MARK>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT_MARK), timeoutMs);
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
        const message = `生成超时（超过 ${Math.round(timeoutMs / 60000)} 分钟），已中止并标记失败`;
        await this.failProject(id, fallbackStage, message, runId);
        throw new Error(message);
      }

      // 同步执行进度（冗余写入，便于查询与前端展示）。
      // 大纲节点内部暂停时父图状态仍是进入该节点前的阶段，
      // 因此本次执行若已把 Project 阶段推进过，就以持久化的业务进度为准，
      // 不能用父图旧状态覆盖节点写入的阶段。
      const persisted = await this.prisma.project.findUnique({
        where: { id },
        select: { currentStage: true },
      });
      // 子图恢复后再次暂停时，数据库阶段可能与本次入口相同（均为 outline），
      // 父图却仍保留进入子图前的 relations；此时也必须保留业务阶段。
      const advanced = persisted?.currentStage as Stage | undefined;
      const currentStage = laterStage(
        outcome.state.currentStage ?? fallbackStage,
        advanced,
        stages,
      );
      await this.prisma.project.updateMany({
        where: { id, runId, ...VISIBLE_PROJECT },
        data: {
          currentStage,
          status:
            currentStage === stages.at(-1) &&
            (currentStage !== 'prose' || !this.prose || (await this.prose.detail(id)).completed)
              ? 'done'
              : 'idle',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failProject(id, fallbackStage, message, runId);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 标记项目失败。若阶段产物还停在 generating（如超时中断），补记为 failed；
   * 已由 runner 标记为 failed 的不再覆盖，避免误伤已完成阶段。
   */
  private async failProject(
    id: string,
    fallbackStage: Stage,
    message?: string,
    runId?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.project.updateMany({
        where: { id, runId, ...VISIBLE_PROJECT, status: 'running' },
        data: { status: 'failed' },
      });
      if (owned.count !== 1) return;
      const project = await tx.project.findUniqueOrThrow({ where: { id } });
      const stage = (project.currentStage ?? fallbackStage) as Stage;
      if (message) {
        await tx.stageRun.upsert({
          where: { projectId_runId_stage: { projectId: id, runId: runId!, stage } },
          create: { projectId: id, runId: runId!, stage, status: 'failed', error: message },
          update: { status: 'failed', error: message },
        });
        const { storageFor } = await import('./stage-storage.js');
        await storageFor(stage)?.write(tx, id, { status: 'failed', error: message });
      }
    });
  }
}
