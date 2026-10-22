import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import {
  ChapterBatchSchema,
  ChapterSummarySchema,
  OutlinePlanSchema,
  TargetChaptersSchema,
  type ChapterSummary,
  type OutlineConfirm,
  type OutlineDetail,
  type OutlinePlan,
  type OutlineProgress,
  type QuestionnaireAnswers,
  type Stage,
  type StageContext,
} from '@rill/shared';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { ArtifactRegistry } from '../pipeline/artifact.registry.js';
import { UpstreamAssembler } from '../pipeline/upstream.assembler.js';
import { commitGeneration, executionContext } from '../pipeline/execution-context.js';
import { markDownstreamStale, setStageStatus } from '../pipeline/stage.runner.js';
import type { PipelineState } from '../pipeline/pipeline.graph.js';
import { profileFor } from '../genre/genre-profile.js';
import { LlmService } from '../../ai/llm.service.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { UsageRecorder } from '../../ai/observability/usage-recorder.js';
import { newTraceId } from '../../ai/observability/trace.js';
import { outlineChaptersV1, outlinePlanV1 } from '../prompts/outline-template.js';
import { splitBatches, validateChapters, validatePlan } from './outline.validation.js';

type OutlineRow = Prisma.OutlineGetPayload<{ include: { batches: true } }>;

/** 大纲确认请求的推进意图，由 checkConfirm 只读判定 */
export type OutlineConfirmDecision = 'commit' | 'advance' | 'skip';

/** 单次模型调用的选项：批次用量归属、剩余预算与同一事务内的结果写入 */
interface OutlineCallOptions<T> {
  batchId?: string;
  remainingMs?: number;
  /** 成功调用的结果写入：与这次调用的已知用量在同一事务提交 */
  persist?: (tx: Prisma.TransactionClient, result: T) => Promise<void>;
}

@Injectable()
export class OutlineService {
  readonly stage: Stage = 'outline';
  readonly requires = (answers: QuestionnaireAnswers): Stage[] =>
    [
      'premise',
      'characters',
      'relations',
      ...(profileFor(answers.genre).skipStages.includes('world') ? [] : ['world']),
    ] as Stage[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactRegistry,
    private readonly assembler: UpstreamAssembler,
    private readonly llm: LlmService,
    private readonly prompts: PromptRegistry,
    private readonly usage: UsageRecorder,
    private readonly config: ConfigService,
  ) {
    // 注册依赖和失效规则；实际生成由子图的各节点执行。
    artifacts.registerGenerator(this);
    artifacts.registerStorage('outline', prisma);
    prompts.register(outlinePlanV1);
    prompts.register(outlineChaptersV1);
  }

  async generate(_context: StageContext, _answers: QuestionnaireAnswers, projectId: string) {
    throw new BadRequestException(`项目 ${projectId} 的大纲必须通过大纲子图执行`);
  }

  private async project(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    // 回收站中的项目不可编辑：大纲的一切读写都要求它仍在创作列表中
    if (!project || project.deletedAt) throw new NotFoundException('项目不存在');
    return project;
  }

  private async row(id: string) {
    return this.prisma.outline.findUnique({ where: { projectId: id }, include: { batches: true } });
  }

  private chapters(row: OutlineRow): ChapterSummary[] {
    return row.batches
      .filter(
        (batch) => batch.planRevision === row.planRevision && batch.status === 'done' && batch.data,
      )
      .flatMap((batch) => ChapterBatchSchema.parse(JSON.parse(batch.data!)).chapters)
      .sort((a, b) => a.number - b.number);
  }

  async get(id: string): Promise<OutlineDetail> {
    const project = await this.project(id);
    const row = await this.row(id);
    if (!row)
      return {
        targetChapters: profileFor(project.genre as QuestionnaireAnswers['genre'])
          .suggestedChapters[project.length as QuestionnaireAnswers['length']],
        step: 'planning',
        revision: 0,
        planRevision: 0,
        planConfirmedRevision: null,
        confirmedRevision: null,
        stale: false,
        completedChapters: 0,
        completedBatches: 0,
        totalBatches: 0,
        error: null,
        plan: null,
        chapters: [],
        batches: [],
        staleChapters: [],
      };
    const batches = row.batches
      .filter((batch) => batch.planRevision === row.planRevision)
      .sort((a, b) => a.startChapter - b.startChapter);
    const chapters = this.chapters(row);
    const run = await this.prisma.stageRun.findFirst({
      where: { projectId: id, stage: 'outline' },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      targetChapters: row.targetChapters,
      step: z
        .enum(['planning', 'plan_review', 'expanding', 'outline_review', 'confirmed'])
        .parse(row.step),
      revision: row.revision,
      planRevision: row.planRevision,
      planConfirmedRevision: row.planConfirmedRevision,
      confirmedRevision: row.confirmedRevision,
      stale: row.stale,
      completedChapters: chapters.length,
      completedBatches: batches.filter((b) => b.status === 'done').length,
      totalBatches: batches.length,
      error: run?.error ?? null,
      plan: row.planData ? OutlinePlanSchema.parse(JSON.parse(row.planData)) : null,
      chapters,
      batches: batches.map(({ startChapter, endChapter, status, error }) => ({
        startChapter,
        endChapter,
        status,
        error,
      })),
      staleChapters: row.batches
        .filter((b) => b.planRevision !== row.planRevision && b.data)
        .flatMap((b) => ChapterBatchSchema.parse(JSON.parse(b.data!)).chapters),
    };
  }

  async progress(id: string): Promise<OutlineProgress | null> {
    if (!(await this.row(id))) return null;
    const detail = await this.get(id);
    return {
      targetChapters: detail.targetChapters,
      step: detail.step,
      revision: detail.revision,
      planRevision: detail.planRevision,
      planConfirmedRevision: detail.planConfirmedRevision,
      confirmedRevision: detail.confirmedRevision,
      stale: detail.stale,
      completedChapters: detail.completedChapters,
      completedBatches: detail.completedBatches,
      totalBatches: detail.totalBatches,
      error: detail.error,
    };
  }

  private async upstream(id: string) {
    const context = await this.assembler.assemble(id, 'outline');
    const project = await this.project(id);
    if (project.mode === 'manual') {
      for (const stage of this.requires(JSON.parse(project.answers))) {
        const latest = await this.prisma.stageRun.findFirst({
          where: { projectId: id, stage },
          orderBy: { updatedAt: 'desc' },
        });
        // 兼容没有 StageRun 的旧项目，迁移前产物 done 表示已完成。
        if (latest && !latest.confirmedAt)
          throw new BadRequestException(`上游阶段 ${stage} 尚未确认`);
      }
    }
    return context;
  }

  /** 人工编辑和生成入口争用同一项目写锁，检查与保存均在事务内。 */
  private async edit(
    id: string,
    revision: number,
    write: (tx: Prisma.TransactionClient, row: OutlineRow) => Promise<void>,
  ) {
    await this.project(id);
    await this.upstream(id);
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.project.updateMany({
        where: { id, currentStage: 'outline', status: { not: 'running' }, runId: null },
        data: { status: 'idle' },
      });
      if (locked.count !== 1)
        throw new ConflictException('正在生成或不在大纲阶段，请等待或先回退到大纲');
      let row = await tx.outline.findUnique({
        where: { projectId: id },
        include: { batches: true },
      });
      if (!row) {
        if (revision !== 0)
          throw new ConflictException('内容版本冲突，请刷新后核对；本地输入已保留');
        const project = await tx.project.findUniqueOrThrow({ where: { id } });
        row = await tx.outline.create({
          data: {
            projectId: id,
            targetChapters: profileFor(project.genre as QuestionnaireAnswers['genre'])
              .suggestedChapters[project.length as QuestionnaireAnswers['length']],
          },
          include: { batches: true },
        });
      }
      if (row.revision !== revision)
        throw new ConflictException('内容版本冲突，请刷新后核对；本地输入已保留');
      await write(tx, row);
      const project = await tx.project.findUniqueOrThrow({ where: { id } });
      // 在同一事务调用统一存储适配，编辑失败时失效操作也回滚。
      const { storageFor } = await import('../pipeline/stage-storage.js');
      for (const stage of ['beats', 'prose'] as Stage[]) {
        await tx.stageRun.updateMany({ where: { projectId: id, stage }, data: { stale: true } });
        await storageFor(stage)?.invalidate(tx, project.id, true);
      }
      await tx.stageRun.updateMany({
        where: { projectId: id, stage: 'outline' },
        data: { confirmedAt: null, stale: false, status: 'done', error: null },
      });
    });
    return this.get(id);
  }

  async configure(id: string, expectedRevision: number, targetChapters: number) {
    TargetChaptersSchema.parse(targetChapters);
    return this.edit(id, expectedRevision, async (tx, row) => {
      await tx.outline.update({
        where: { id: row.id },
        data: {
          targetChapters,
          revision: { increment: 1 },
          planRevision: { increment: 1 },
          planConfirmedRevision: null,
          confirmedRevision: null,
          step: 'planning',
          planData: null,
          stale: false,
        },
      });
    });
  }

  async savePlan(id: string, expectedRevision: number, plan: OutlinePlan) {
    const context = await this.upstream(id);
    return this.edit(id, expectedRevision, async (tx, row) => {
      validatePlan(plan, row.targetChapters, context.characterRefs?.map((c) => c.id) ?? []);
      const planRevision = row.planRevision + 1;
      await tx.outline.update({
        where: { id: row.id },
        data: {
          planData: JSON.stringify(OutlinePlanSchema.parse(plan)),
          revision: { increment: 1 },
          planRevision,
          planConfirmedRevision: null,
          confirmedRevision: null,
          stale: false,
          step: 'plan_review',
        },
      });
      await tx.outlineBatch.createMany({
        data: splitBatches(plan).map((batch) => ({ ...batch, outlineId: row.id, planRevision })),
      });
    });
  }

  async saveChapter(id: string, expectedRevision: number, number: number, chapter: ChapterSummary) {
    const context = await this.upstream(id);
    return this.edit(id, expectedRevision, async (tx, row) => {
      if (row.stale || row.planConfirmedRevision !== row.planRevision)
        throw new BadRequestException('规划尚未确认或已失效');
      const batch = row.batches.find(
        (b) =>
          b.planRevision === row.planRevision &&
          b.startChapter <= number &&
          b.endChapter >= number &&
          b.status === 'done',
      );
      if (!batch?.data || chapter.number !== number)
        throw new BadRequestException('章号不可改变或章节尚未生成');
      const chapters = ChapterBatchSchema.parse(JSON.parse(batch.data)).chapters.map((c) =>
        c.number === number ? ChapterSummarySchema.parse(chapter) : c,
      );
      validateChapters(chapters, batch, context.characterRefs?.map((c) => c.id) ?? []);
      await tx.outlineBatch.update({
        where: { id: batch.id },
        data: { data: JSON.stringify({ chapters }) },
      });
      await tx.outline.update({
        where: { id: row.id },
        data: {
          revision: { increment: 1 },
          confirmedRevision: null,
          step: row.step === 'confirmed' ? 'outline_review' : row.step,
        },
      });
    });
  }

  /**
   * 领取运行权前只读校验；实际确认仍由子图节点再次校验。
   * 返回的推进意图：`commit` 表示需要图执行大纲节点完成本次业务确认，
   * `advance` 表示当前版本已是最终确认版本且仍在大纲阶段（多为作者回退后直接确认），
   * `skip` 表示幂等重复确认——内容已确认且流程已在该阶段之后，不改变任何进度。
   */
  async checkConfirm(id: string, confirm: OutlineConfirm): Promise<OutlineConfirmDecision> {
    const detail = await this.get(id);
    if (detail.revision !== confirm.expectedRevision)
      throw new ConflictException('大纲版本冲突，请刷新后核对');
    if (detail.stale) throw new BadRequestException('大纲已失效，请重新生成');
    if (confirm.target === 'outline-plan') {
      if (detail.planConfirmedRevision === detail.planRevision && detail.plan !== null)
        return 'skip';
      if (detail.step !== 'plan_review' || !detail.plan)
        throw new BadRequestException('当前不是全书规划待确认步骤');
    } else {
      if (detail.confirmedRevision === detail.revision)
        // 完整大纲已按当前版本确认：只有仍停留在大纲阶段才表示作者要从该版本继续推进，
        // 流程已到下游时的重复确认保持幂等。
        return (await this.project(id)).currentStage === 'outline' ? 'advance' : 'skip';
      if (detail.step !== 'outline_review') throw new BadRequestException('完整章纲尚未生成');
    }
    await this.upstream(id);
    return 'commit';
  }

  async acceptConfirmation(id: string, target: OutlineConfirm['target'], expectedRevision: number) {
    const detail = await this.get(id);
    const context = await this.upstream(id);
    if (detail.revision !== expectedRevision || detail.stale || !detail.plan)
      throw new ConflictException('大纲版本或有效性已变化');
    validatePlan(detail.plan, detail.targetChapters, context.characterRefs?.map((c) => c.id) ?? []);
    if (target === 'outline') {
      if (detail.planConfirmedRevision !== detail.planRevision)
        throw new BadRequestException('全书规划尚未确认');
      for (const batch of splitBatches(detail.plan))
        validateChapters(
          detail.chapters.filter(
            (c) => c.number >= batch.startChapter && c.number <= batch.endChapter,
          ),
          batch,
          context.characterRefs?.map((c) => c.id) ?? [],
        );
      if (detail.chapters.length !== detail.targetChapters)
        throw new BadRequestException('章纲不完整');
    }
    await commitGeneration(this.prisma, async (tx) => {
      const updated = await tx.outline.updateMany({
        where: { projectId: id, revision: expectedRevision, stale: false },
        data:
          target === 'outline-plan'
            ? { planConfirmedRevision: detail.planRevision, step: 'expanding' }
            : { confirmedRevision: detail.revision, step: 'confirmed' },
      });
      if (updated.count !== 1) throw new ConflictException('大纲版本已变化');
      if (target === 'outline')
        await tx.stageRun.updateMany({
          where: { projectId: id, stage: 'outline', stale: false },
          data: { status: 'done', confirmedAt: new Date() },
        });
    });
  }

  private async review(state: PipelineState, target: OutlineConfirm['target']) {
    const detail = await this.get(state.projectId);
    if (
      target === 'outline-plan'
        ? detail.planConfirmedRevision === detail.planRevision && !!detail.plan
        : detail.confirmedRevision === detail.revision
    )
      return { currentStage: 'outline' as Stage };
    if ((await this.project(state.projectId)).mode === 'manual') {
      const answer = interrupt({
        target,
        revision: detail.revision,
        projectId: state.projectId,
      }) as OutlineConfirm;
      if (answer?.target !== target) throw new BadRequestException('确认目标不匹配');
      await this.acceptConfirmation(state.projectId, target, answer.expectedRevision);
    } else {
      await this.acceptConfirmation(state.projectId, target, detail.revision);
    }
    return { currentStage: 'outline' as Stage };
  }

  readonly nodes = {
    generatePlan: (state: PipelineState) => this.runStep(state, () => this.plan(state)),
    reviewPlan: (state: PipelineState) => this.review(state, 'outline-plan'),
    expand: (state: PipelineState) => this.runStep(state, () => this.expand(state)),
    reviewOutline: (state: PipelineState) => this.review(state, 'outline'),
  };

  private async runStep(state: PipelineState, fn: () => Promise<void>) {
    await commitGeneration(this.prisma, async (tx) => {
      await tx.project.update({
        where: { id: state.projectId },
        data: { currentStage: 'outline' },
      });
    });
    await setStageStatus(this.prisma, state.projectId, 'outline', 'generating');
    try {
      await fn();
      await setStageStatus(this.prisma, state.projectId, 'outline', 'done');
      return { currentStage: 'outline' as Stage };
    } catch (error) {
      await setStageStatus(
        this.prisma,
        state.projectId,
        'outline',
        'failed',
        error instanceof Error ? error.message : '大纲生成失败',
      );
      throw error;
    }
  }

  private async plan(state: PipelineState) {
    const id = state.projectId;
    const context = await this.upstream(id);
    let row = await this.row(id);
    if (row?.planData && !row.stale) return;
    await markDownstreamStale(this.artifacts, id, 'outline', state.answers.genre);
    if (!row) {
      await commitGeneration(this.prisma, async (tx) => {
        await tx.outline.create({
          data: {
            projectId: id,
            targetChapters: profileFor(state.answers.genre).suggestedChapters[state.answers.length],
          },
        });
      });
      row = await this.row(id);
    }
    const current = row!;
    const ids = context.characterRefs?.map((c) => c.id) ?? [];
    const schema = OutlinePlanSchema.superRefine((value, ctx) => {
      try {
        validatePlan(value, current.targetChapters, ids);
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : '规划校验失败' });
      }
    });
    await this.call<OutlinePlan>(
      id,
      schema,
      this.prompts.render('outline-plan', 'v1', {
        context: JSON.stringify({ answers: state.answers, ...context }),
        target: String(current.targetChapters),
      }),
      {
        // 内容、完成状态与本次调用的已知用量在同一事务提交：
        // 避免两个事务之间中断留下「已记账但规划未落地」的中间状态。
        persist: async (tx, result) => {
          validatePlan(result, current.targetChapters, ids);
          const planRevision = current.planRevision + 1;
          const updated = await tx.outline.updateMany({
            where: { id: current.id, revision: current.revision },
            data: {
              planData: JSON.stringify(result),
              planRevision,
              revision: { increment: 1 },
              planConfirmedRevision: null,
              confirmedRevision: null,
              stale: false,
              step: 'plan_review',
            },
          });
          if (updated.count !== 1) throw new ConflictException('规划版本已变化');
          await tx.outlineBatch.createMany({
            data: splitBatches(result).map((batch) => ({
              ...batch,
              outlineId: current.id,
              planRevision,
            })),
          });
        },
      },
    );
  }

  private async expand(state: PipelineState) {
    const id = state.projectId;
    const context = await this.upstream(id);
    const row = await this.row(id);
    if (!row || row.stale || row.planConfirmedRevision !== row.planRevision || !row.planData)
      throw new BadRequestException('必须先确认有效的全书规划');
    if (row.step === 'outline_review' || row.step === 'confirmed') return;
    const plan = OutlinePlanSchema.parse(JSON.parse(row.planData));
    const ids = context.characterRefs?.map((c) => c.id) ?? [];
    const started = Date.now();
    const budget = this.config.get<number>('outline.totalTimeoutMs') ?? 8 * 60_000;
    for (const batch of [...row.batches]
      .filter((b) => b.planRevision === row.planRevision)
      .sort((a, b) => a.startChapter - b.startChapter)) {
      if (batch.status === 'done') continue;
      if (Date.now() - started >= budget)
        throw new Error('大纲本次执行预算耗尽，已保存进度，请续跑');
      try {
        const previous = this.chapters((await this.row(id))!).map((c) => ({
          number: c.number,
          events: c.events.slice(0, 160),
          outcome: c.outcome.slice(0, 100),
          consequence: c.consequence.slice(0, 100),
        }));
        const schema = ChapterBatchSchema.superRefine((value, ctx) => {
          try {
            validateChapters(value.chapters, batch, ids);
          } catch (e) {
            ctx.addIssue({
              code: 'custom',
              message: e instanceof Error ? e.message : '章纲校验失败',
            });
          }
        });
        await this.call<{ chapters: ChapterSummary[] }>(
          id,
          schema,
          this.prompts.render('outline-chapters', 'v1', {
            context: JSON.stringify({ answers: state.answers, ...context }),
            plan: JSON.stringify(plan),
            previous: JSON.stringify(previous),
            batch: JSON.stringify({
              startChapter: batch.startChapter,
              endChapter: batch.endChapter,
              segmentId: batch.segmentId,
            }),
          }),
          {
            batchId: batch.id,
            remainingMs: Math.max(1, budget - (Date.now() - started)),
            // 批次内容、完成状态与本次调用的已知用量原子提交，
            // 避免两事务之间中断留下「已记账但批次未完成」的状态。
            persist: async (tx, result) => {
              validateChapters(result.chapters, batch, ids);
              const valid = await tx.outline.updateMany({
                where: {
                  id: row.id,
                  planRevision: row.planRevision,
                  stale: false,
                  step: 'expanding',
                },
                data: { revision: { increment: 1 } },
              });
              if (valid.count !== 1) throw new ConflictException('旧规划结果已失效');
              await tx.outlineBatch.update({
                where: { id: batch.id },
                data: { data: JSON.stringify(result), status: 'done', error: null },
              });
            },
          },
        );
      } catch (error) {
        await commitGeneration(this.prisma, async (tx) => {
          const valid = await tx.outline.findFirst({
            where: { id: row.id, planRevision: row.planRevision, stale: false },
          });
          if (!valid) return;
          await tx.outlineBatch.update({
            where: { id: batch.id },
            data: { status: 'failed', error: error instanceof Error ? error.message : '生成失败' },
          });
        });
        throw error;
      }
    }
    await commitGeneration(this.prisma, async (tx) => {
      await tx.outline.update({ where: { id: row.id }, data: { step: 'outline_review' } });
    });
  }

  private async call<T>(
    id: string,
    schema: z.ZodType,
    prompt: string,
    options: OutlineCallOptions<T> = {},
  ): Promise<T> {
    const traceId = newTraceId();
    const timeoutMs = Math.min(
      this.config.get<number>('outline.callTimeoutMs') ?? 120_000,
      options.remainingMs ?? Infinity,
    );
    const controller = new AbortController();
    const executionSignal = executionContext.getStore()?.signal;
    const signal = executionSignal
      ? AbortSignal.any([controller.signal, executionSignal])
      : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let called = false;
    try {
      const result = await Promise.race([
        this.llm.completeStructured<T>(schema, [{ role: 'user', content: prompt }], {
          traceId,
          signal,
          maxTokens: this.config.get<number>('outline.maxTokens') ?? 8192,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('大纲单批生成超时，已保存进度，请续跑'));
          }, timeoutMs);
          timer.unref?.();
        }),
      ]);
      called = true;
      const { persist } = options;
      // 成功调用：内容与本次已知用量在同一事务提交（见 commitUsage）
      await this.commitUsage(
        id,
        traceId,
        options.batchId,
        persist
          ? async (tx) => {
              await persist(tx, result);
            }
          : undefined,
      );
      return result;
    } catch (error) {
      if (called)
        // 内容或状态提交被拒绝（版本冲突或运行失效）不影响用量入账：
        // 真实调用已经产生开销，此处补齐记账而不替换原始错误。
        await this.commitUsage(id, traceId, options.batchId).catch(() => undefined);
      else await this.commitUsage(id, traceId, options.batchId);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 记录一次调用的已知用量，并可选地把调用结果在同一事务提交。
   * 唯一 traceId 保证重复提交只入账一次；内容与用量原子落地，
   * 避免两个事务之间中断导致批次状态与账本不一致。
   */
  private async commitUsage(
    id: string,
    traceId: string,
    batchId?: string,
    persist?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    const record = this.usage.get(traceId);
    if (!record && !persist) return;
    await commitGeneration(this.prisma, async (tx) => {
      if (record && !(await tx.outlineUsage.findUnique({ where: { traceId } }))) {
        await tx.outlineUsage.create({
          data: {
            traceId,
            projectId: id,
            promptTokens: record.promptTokens,
            completionTokens: record.completionTokens,
          },
        });
        await tx.project.update({
          where: { id },
          data: {
            promptTokens: { increment: record.promptTokens },
            completionTokens: { increment: record.completionTokens },
          },
        });
        if (batchId)
          await tx.outlineBatch.update({
            where: { id: batchId },
            data: {
              promptTokens: { increment: record.promptTokens },
              completionTokens: { increment: record.completionTokens },
            },
          });
      }
      await persist?.(tx);
    });
  }
}
