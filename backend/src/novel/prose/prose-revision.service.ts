import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  ProseRevisionOutputSchema,
  CreateProseRevisionBodySchema,
  ApplyProseRevisionBodySchema,
  type CreateProseRevisionBody,
  type ApplyProseRevisionBody,
} from '@rill/shared';
import type { ProseRevision } from '../../../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { LlmService } from '../../ai/llm.service.js';
import { acquireProjectRun } from '../pipeline/project-run.js';
import { commitGeneration, executionContext } from '../pipeline/execution-context.js';
import { ProseService } from './prose.service.js';
import { proseHash } from './prose-files.service.js';
import { buildProseChanges, revisionDetail } from './prose-revision-data.js';

@Injectable()
export class ProseRevisionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly tasks = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  constructor(
    private readonly prisma: PrismaService,
    private readonly prose: ProseService,
    private readonly llm: LlmService,
  ) {}

  /** 在流水线释放旧运行锁之后恢复。生成可安全重试，已发布的应用必须先恢复证据。 */
  async onApplicationBootstrap() {
    const pending = await this.prisma.proseRevision.findMany({
      where: {
        status: { in: ['generating', 'applying', 'recovery_required'] },
        project: { deletedAt: null },
      },
    });
    for (const row of pending) {
      if (row.status === 'generating') {
        await this.prisma.$transaction(async (tx) => {
          await tx.proseRevision.update({
            where: { id: row.id },
            data: { status: 'failed', error: '服务重启中断了修改预览，请重新生成' },
          });
          await tx.project.updateMany({
            where: { id: row.projectId, runId: null },
            data: { status: row.originalStatus },
          });
        });
      } else {
        const project = await this.prose.project(row.projectId);
        // recovery_required 的保留锁只由启动恢复接管。
        if (project.runId === row.runId)
          await this.prisma.project.update({
            where: { id: project.id },
            data: { runId: null, status: 'failed' },
          });
        const runId = await acquireProjectRun(this.prisma, await this.prose.project(row.projectId));
        const next = await this.prisma.proseRevision.update({
          where: { id: row.id },
          data: { runId, status: 'applying', error: null },
        });
        this.launch(next, true);
      }
    }
  }
  async onModuleDestroy() {
    for (const task of this.tasks.values()) task.controller.abort();
    await Promise.allSettled([...this.tasks.values()].map((task) => task.promise));
  }
  private async row(id: string, number: number, revisionId: string) {
    await this.prose.project(id);
    const row = await this.prisma.proseRevision.findFirst({
      where: { id: revisionId, projectId: id, chapterNumber: number },
    });
    if (!row) throw new NotFoundException('修改记录不存在');
    return row;
  }
  async get(id: string, number: number, revisionId: string) {
    const row = await this.row(id, number, revisionId);
    if (row.status === 'ready') {
      const project = await this.prose.project(id);
      if (project.status !== 'running') {
        try {
          const context = await this.prose.revisionContext(id, number);
          this.checkBase(row, context);
        } catch {
          return revisionDetail(
            await this.prisma.proseRevision.update({
              where: { id: row.id },
              data: { status: 'stale', error: '正文或前文已变化，请重新生成修改预览' },
            }),
          );
        }
      }
    }
    return revisionDetail(row);
  }
  private checkBase(
    row: ProseRevision,
    context: Awaited<ReturnType<ProseService['revisionContext']>>,
  ) {
    if (
      context.row.revision !== row.baseRevision ||
      context.file.hash !== row.baseHash ||
      context.deps.fingerprint !== row.dependencyFingerprint
    )
      throw new ConflictException('正文或前文已变化，请重新生成修改预览');
  }
  async create(id: string, number: number, input: CreateProseRevisionBody) {
    const body = CreateProseRevisionBodySchema.parse(input);
    await this.prose.project(id);
    const requestHash = proseHash(
      JSON.stringify({
        number,
        ...body,
        reviewSelection: body.reviewSelection
          ? {
              ...body.reviewSelection,
              issueIndexes: [...body.reviewSelection.issueIndexes].sort((a, b) => a - b),
            }
          : undefined,
      }),
    );
    const previous = await this.prisma.proseRevision.findUnique({
      where: { projectId_requestId: { projectId: id, requestId: body.requestId } },
    });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new ConflictException('请求标识已用于其他修改');
      return revisionDetail(previous);
    }
    const context = await this.prose.revisionContext(id, number);
    if (context.project.currentStage !== 'prose') throw new BadRequestException('请先进入正文阶段');
    if (body.expectedRevision !== context.row.revision || body.expectedHash !== context.file.hash)
      throw new ConflictException('正文已变化，请重新加载');
    const selection = body.reviewSelection;
    if (selection && (!context.report || context.report.id !== selection.reviewId))
      throw new ConflictException('审核报告已失效，请重新选择建议');
    const suggestions = (selection?.issueIndexes ?? []).map((issueIndex) => {
      const issue = context.report?.issues[issueIndex];
      if (!issue) throw new BadRequestException('所选审核建议不存在');
      return {
        issueIndex,
        problem: issue.problem,
        suggestion: issue.suggestion,
        evidence: issue.evidence,
        basis: issue.basis,
        location: issue.location,
      };
    });
    const row = await this.prisma.$transaction(async (tx) => {
      const runId = await acquireProjectRun(tx, context.project);
      return tx.proseRevision.create({
        data: {
          projectId: id,
          chapterNumber: number,
          requestId: body.requestId,
          requestHash,
          baseRevision: context.row.revision,
          baseHash: context.file.hash!,
          originalContent: context.file.content!,
          dependencyFingerprint: context.deps.fingerprint,
          feedback: body.feedback,
          reviewId: selection?.reviewId,
          suggestionsData: JSON.stringify(suggestions),
          runId,
          originalStatus: context.project.status,
        },
      });
    });
    this.launch(row, false);
    return revisionDetail(row);
  }
  async apply(id: string, number: number, revisionId: string, input: ApplyProseRevisionBody) {
    const body = ApplyProseRevisionBodySchema.parse(input);
    const row = await this.row(id, number, revisionId);
    if (row.applyRequestId) {
      if (
        row.applyRequestId !== body.requestId ||
        body.expectedRevision !== row.baseRevision ||
        body.expectedHash !== row.baseHash
      )
        throw new ConflictException('该修改已提交应用，请读取最新结果');
      return revisionDetail(row);
    }
    if (row.status !== 'ready' || !row.content) throw new ConflictException('本次修改不可应用');
    const context = await this.prose.revisionContext(id, number);
    this.checkBase(row, context);
    if (body.expectedRevision !== row.baseRevision || body.expectedHash !== row.baseHash)
      throw new ConflictException('修改基础版本不匹配');
    const next = await this.prisma.$transaction(async (tx) => {
      const runId = await acquireProjectRun(tx, context.project);
      const claimed = await tx.proseRevision.updateMany({
        where: { id: row.id, status: 'ready', applyRequestId: null },
        data: {
          status: 'applying',
          applyPhase: 'prepared',
          applyRequestId: body.requestId,
          runId,
          originalStatus: context.project.status,
        },
      });
      if (claimed.count !== 1) throw new ConflictException('修改已提交或已放弃');
      return tx.proseRevision.findUniqueOrThrow({ where: { id: row.id } });
    });
    this.launch(next, true);
    return revisionDetail(next);
  }
  async discard(id: string, number: number, revisionId: string) {
    const row = await this.row(id, number, revisionId);
    if (row.status === 'discarded') return revisionDetail(row);
    const discarded = await this.prisma.proseRevision.updateMany({
      where: { id: row.id, status: 'ready', applyRequestId: null },
      data: { status: 'discarded' },
    });
    if (!discarded.count) throw new ConflictException('该修改当前不可放弃');
    return this.get(id, number, revisionId);
  }
  async restore(id: string, number: number) {
    const project = await this.prose.project(id);
    if (project.currentStage !== 'prose') throw new BadRequestException('请先进入正文阶段');
    const runId = await acquireProjectRun(this.prisma, project);
    let restored = false;
    try {
      await executionContext.run(
        { projectId: id, runId, signal: new AbortController().signal },
        async () => {
          const file = await this.prose.files.read(id, number);
          if (file.status === 'valid') throw new ConflictException('正文文件正常，无需恢复');
          const snapshot = await this.prose.savedSnapshot(id, number);
          if (!snapshot) throw new BadRequestException('没有可信的已保存正文快照');
          await this.prose.files.replace(id, number, file.hash, snapshot.content);
          // 恢复也通过现有扫描机制失效旧接受证据，不自动接受。
          await this.prose.reconcile(id);
          restored = true;
        },
      );
    } finally {
      await this.prisma.project.updateMany({
        where: { id, runId, deletedAt: null },
        data: { status: restored ? 'idle' : project.status, runId: null },
      });
    }
    return this.prose.detail(id);
  }
  private launch(row: ProseRevision, apply: boolean) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('正文修改操作超时，请重试')),
      10 * 60 * 1000,
    );
    const promise = executionContext
      .run({ projectId: row.projectId, runId: row.runId, signal: controller.signal }, async () => {
        try {
          await Promise.race([
            apply ? this.publish(row) : this.generate(row),
            new Promise<never>((_, reject) =>
              controller.signal.addEventListener(
                'abort',
                () => reject(new Error('正文修改操作已中断，请重试')),
                { once: true },
              ),
            ),
          ]);
        } catch (error) {
          // 发布结果按日志与实际哈希区分；不能把已应用正文的审核失败描述成修改失败。
          const current = await this.prisma.proseRevision.findUnique({ where: { id: row.id } });
          const file = await this.prose.files.read(row.projectId, row.chapterNumber);
          const committed = current?.applyPhase === 'committed';
          const needsRecovery = apply && !committed && file.hash !== row.baseHash;
          await this.prisma.$transaction(async (tx) => {
            const owner = await tx.project.findFirst({
              where: { id: row.projectId, runId: row.runId, deletedAt: null },
            });
            if (!owner) return;
            await tx.proseRevision.update({
              where: { id: row.id },
              data: {
                status: committed
                  ? 'applied'
                  : needsRecovery
                    ? 'recovery_required'
                    : apply
                      ? 'conflict'
                      : 'failed',
                error: error instanceof Error ? error.message : '正文修改失败',
              },
            });
          });
        } finally {
          clearTimeout(timer);
          const current = await this.prisma.proseRevision.findUnique({ where: { id: row.id } });
          await this.prisma.project.updateMany({
            where: { id: row.projectId, runId: row.runId, deletedAt: null },
            data: {
              status:
                current?.status === 'recovery_required'
                  ? 'failed'
                  : apply && current?.applyPhase === 'committed'
                    ? 'idle'
                    : row.originalStatus,
              runId: current?.status === 'recovery_required' ? row.runId : null,
            },
          });
        }
      })
      .catch(() => {
        /* 数据库不可用时日志与运行锁保留，由启动恢复接管。 */
      })
      .finally(() => this.tasks.delete(row.id));
    this.tasks.set(row.id, { controller, promise });
  }
  private async generate(row: ProseRevision) {
    const context = await this.prose.revisionContext(row.projectId, row.chapterNumber);
    this.checkBase(row, context);
    const suggestions: Array<{ issueIndex: number }> = JSON.parse(row.suggestionsData);
    const output = ProseRevisionOutputSchema.parse(
      await this.prose.revisionCall(row.projectId, row.chapterNumber, (traceId) =>
        this.llm.completeStructured(
          ProseRevisionOutputSchema,
          [
            {
              role: 'user',
              content: this.prose.revisionPrompt({
                answers: JSON.parse(context.project.answers),
                context: {
                  ...context.deps.context,
                  outline: {
                    plan: context.deps.context.outline!.plan,
                    chapters: context.deps.context.outline!.chapters.filter(
                      (c) => c.number === row.chapterNumber,
                    ),
                  },
                },
                chapterNumber: row.chapterNumber,
                originalContent: row.originalContent,
                previous: context.deps.previous,
                feedback: row.feedback,
                suggestions: JSON.parse(row.suggestionsData),
              }),
            },
          ],
          { traceId, maxTokens: 8192, rejectTruncated: true },
        ),
      ),
    );
    const latest = await this.prose.revisionContext(row.projectId, row.chapterNumber);
    this.checkBase(row, latest);
    if (output.outcome === 'revised') {
      const expected = suggestions.map((s) => s.issueIndex).sort((a, b) => a - b);
      const actual = output.suggestionResponses.map((s) => s.issueIndex).sort((a, b) => a - b);
      if (JSON.stringify(expected) !== JSON.stringify(actual))
        throw new BadRequestException('模型未逐条回应所选建议，请重试');
    }
    await commitGeneration(this.prisma, async (tx) => {
      const revised = output.outcome === 'revised';
      const content = revised ? output.content.replace(/\r\n?/g, '\n') : null;
      const changes = content ? buildProseChanges(row.originalContent, content) : [];
      if (revised && changes.length)
        await tx.proseRevision.updateMany({
          where: { projectId: row.projectId, chapterNumber: row.chapterNumber, status: 'ready' },
          data: { status: 'discarded' },
        });
      await tx.proseRevision.update({
        where: { id: row.id },
        data: {
          status: !revised ? 'blocked' : changes.length ? 'ready' : 'unchanged',
          content,
          resultHash: content ? proseHash(content) : null,
          explanation: output.explanation,
          responsesData: JSON.stringify(revised ? output.suggestionResponses : []),
          changesData: JSON.stringify(changes),
        },
      });
    });
  }
  private async publish(row: ProseRevision) {
    const id = row.projectId,
      n = row.chapterNumber;
    if (!row.content || !row.resultHash) throw new BadRequestException('修改结果不存在');
    if (row.applyPhase !== 'committed') {
      const file = await this.prose.files.read(id, n);
      if (file.hash === row.baseHash) {
        const context = await this.prose.revisionContext(id, n);
        this.checkBase(row, context);
        executionContext.getStore()?.signal.throwIfAborted();
        await this.prose.files.replace(
          id,
          n,
          row.baseHash,
          row.content,
          executionContext.getStore()?.signal,
        );
      } else if (file.hash !== row.resultHash)
        throw new ConflictException('正文文件与修改基线均不一致，已停止覆盖');
      if ((await this.prose.files.read(id, n)).hash !== row.resultHash)
        throw new ConflictException('发布期间正文发生变化');
      await commitGeneration(this.prisma, async (tx) => {
        const current = await tx.proseRevision.findUniqueOrThrow({ where: { id: row.id } });
        if (current.applyPhase === 'committed') return;
        await this.prose.invalidateInTransaction(tx, id, n);
        await tx.proseChapter.updateMany({
          where: { book: { projectId: id }, chapterNumber: n },
          data: {
            observedHash: row.resultHash,
            fileStatus: 'valid',
            generationStatus: 'done',
            reviewStatus: 'pending',
            error: null,
          },
        });
        await tx.proseRevision.update({
          where: { id: row.id },
          data: { applyPhase: 'committed', appliedAt: new Date() },
        });
        await tx.project.update({ where: { id }, data: { currentStage: 'prose' } });
      });
    }
    await this.prose.process(id, n);
    await commitGeneration(this.prisma, async (tx) => {
      await tx.proseRevision.update({
        where: { id: row.id },
        data: { status: 'applied', error: null },
      });
    });
  }
}
