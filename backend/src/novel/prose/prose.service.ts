import { renderWritingStyle } from '../writing-style/writing-style.registry.js';
import { QuestionnaireAnswersSchema } from '@rill/shared';
import { proseDependencyFingerprint } from './prose-fingerprint.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { interrupt } from '@langchain/langgraph';
import {
  ProseDetailSchema,
  ProseChapterNumberSchema,
  ProseReviewOutputSchema,
  ProseFailedReviewSchema,
  ProseReviewReportSchema,
  ProseSummaryOutputSchema,
  ProseSummaryGenerationSchema,
  proseVerdictFor,
  type ConfirmProseBody,
  type OverrideProseReviewBody,
  type ProseDetail,
  type ProseReviewReport,
  type QuestionnaireAnswers,
  type Stage,
  type StageContext,
} from '@rill/shared';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { ArtifactRegistry } from '../pipeline/artifact.registry.js';
import { UpstreamAssembler } from '../pipeline/upstream.assembler.js';
import { commitGeneration, executionContext } from '../pipeline/execution-context.js';
import type { PipelineState } from '../pipeline/pipeline.graph.js';
import { LlmService } from '../../ai/llm.service.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { UsageRecorder } from '../../ai/observability/usage-recorder.js';
import { proseTemplates } from '../prompts/prose-template.js';
import { ProseFilesService, proseHash } from './prose-files.service.js';
import { hasLegacyEvidence, normalizeStoredReview } from './stored-review.js';

type Chapter = Prisma.ProseChapterGetPayload<{ include: { reviews: true; summaries: true } }>;
@Injectable()
export class ProseService {
  readonly stage: Stage = 'prose';
  readonly requires = (): Stage[] => ['outline'];
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactRegistry,
    private readonly assembler: UpstreamAssembler,
    private readonly llm: LlmService,
    private readonly prompts: PromptRegistry,
    private readonly usage: UsageRecorder,
    readonly files: ProseFilesService,
    private readonly config: ConfigService,
  ) {
    artifacts.registerGenerator(this);
    artifacts.register('prose', async (id, stale) => {
      if (stale) await this.invalidate(id, 1);
    });
    proseTemplates.forEach((template) => prompts.register(template));
  }
  private async commit(id: string, write: (tx: Prisma.TransactionClient) => Promise<void>) {
    await commitGeneration(this.prisma, async (tx) => {
      const project = await tx.project.findFirst({ where: { id, deletedAt: null } });
      if (!project) throw new NotFoundException('项目不存在');
      if (!executionContext.getStore() && project.status === 'running')
        throw new ConflictException('项目正在运行，请稍后刷新');
      await write(tx);
    });
  }
  async project(id: string) {
    const row = await this.prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('项目不存在');
    return row;
  }
  private async book(id: string) {
    return this.prisma.proseBook.findUnique({
      where: { projectId: id },
      include: {
        chapters: {
          orderBy: { chapterNumber: 'asc' },
          include: {
            reviews: { orderBy: { createdAt: 'desc' } },
            summaries: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });
  }
  private async ensure(id: string) {
    const project = await this.project(id);
    const outline = await this.prisma.outline.findUnique({ where: { projectId: id } });
    if (!outline) throw new BadRequestException('请先完成大纲');
    await this.commit(id, async (tx) => {
      const book = await tx.proseBook.upsert({
        where: { projectId: id },
        create: { projectId: id, targetChapters: outline.targetChapters },
        update: { targetChapters: outline.targetChapters },
      });
      for (let n = 1; n <= outline.targetChapters; n++)
        await tx.proseChapter.upsert({
          where: { bookId_chapterNumber: { bookId: book.id, chapterNumber: n } },
          create: { bookId: book.id, chapterNumber: n, relativePath: this.files.chapterPath(n) },
          update: {},
        });
    });
    return project;
  }
  async invalidate(id: string, from: number) {
    await this.commit(id, (tx) => this.invalidateInTransaction(tx, id, from));
  }
  async invalidateInTransaction(tx: Prisma.TransactionClient, id: string, from: number) {
    await tx.proseRevision.updateMany({
      where: { projectId: id, chapterNumber: { gte: from }, status: 'ready' },
      data: { status: 'stale', error: '正文或前文已变化，请重新生成修改预览' },
    });
    await tx.proseChapter.updateMany({
      where: { book: { projectId: id }, chapterNumber: { gte: from } },
      data: {
        confirmedHash: null,
        prefixFingerprint: null,
        reviewStatus: 'needs_review',
        stale: true,
        revision: { increment: 1 },
      },
    });
    await tx.proseReview.updateMany({
      where: {
        chapter: { book: { projectId: id }, chapterNumber: { gte: from } },
        status: 'done',
      },
      data: { status: 'stale' },
    });
    await tx.proseSummary.updateMany({
      where: { chapter: { book: { projectId: id }, chapterNumber: { gte: from } } },
      data: { status: 'stale', acceptedAt: null },
    });
    await tx.proseBook.updateMany({
      where: { projectId: id },
      data: { completedRevision: null, revision: { increment: 1 } },
    });
    await tx.stageRun.updateMany({
      where: { projectId: id, stage: 'prose' },
      data: { status: 'pending', confirmedAt: null, stale: true },
    });
    await tx.project.updateMany({
      where: { id, deletedAt: null, status: 'done' },
      data: { status: 'idle', currentStage: 'prose' },
    });
  }
  async revisionContext(id: string, number: number) {
    const project = await this.ensure(id);
    await this.reconcile(id);
    const deps = await this.dependencies(id, number);
    const row = (await this.book(id))!.chapters.find((c) => c.chapterNumber === number)!;
    const file = await this.files.read(id, number);
    if (file.status !== 'valid' || !file.hash || !file.content)
      throw new BadRequestException('本章没有有效正文，无法按建议修改');
    return {
      project,
      deps,
      row,
      file,
      report: row.stale ? null : this.report(row, deps.fingerprint),
    };
  }
  revisionCall<T>(id: string, number: number, invoke: (traceId: string) => Promise<T>) {
    return this.call(id, number, 'revision', invoke);
  }
  revisionPrompt(data: Parameters<ProseService['render']>[1]) {
    return this.render('prose-revision', data);
  }

  async reconcile(id: string) {
    const project = await this.project(id);
    const pending = await this.prisma.proseRevision.findFirst({
      where: { projectId: id, status: { in: ['applying', 'recovery_required'] } },
    });
    if (pending && executionContext.getStore()?.runId !== pending.runId) {
      if (project.status === 'running' && project.runId === pending.runId) return;
      throw new ConflictException('正文修改正在恢复，请稍后重新加载');
    }
    const book = await this.book(id);
    if (!book) return;
    if (project.status === 'running' && executionContext.getStore()?.runId !== project.runId)
      return;
    for (const row of book.chapters.filter(
      (chapter) => chapter.chapterNumber <= book.targetChapters,
    )) {
      const file = await this.files.read(id, row.chapterNumber);
      if (file.hash === row.observedHash && file.status === row.fileStatus) continue;
      await this.invalidate(id, row.chapterNumber);
      await this.commit(id, async (tx) => {
        await tx.proseChapter.update({
          where: { id: row.id },
          data: {
            observedHash: file.hash,
            fileStatus: file.status,
            reviewStatus: 'pending',
            generationStatus: file.status === 'valid' ? 'done' : row.generationStatus,
            error: file.status === 'valid' ? null : `正文文件异常：${file.status}`,
          },
        });
      });
    }
    // 发布操作中断：正文扫描已恢复哈希，但从不推断为人工接受。
    await this.commit(id, async (tx) => {
      await tx.proseOperation.updateMany({
        where: { projectId: id, phase: 'published' },
        data: { phase: 'committed' },
      });
    });
  }
  private async dependencies(id: string, number: number) {
    const context = await this.assembler.assemble(id, 'prose');
    if (!context.outline) throw new BadRequestException('大纲未确认/已失效');
    const outline = await this.prisma.outline.findUniqueOrThrow({ where: { projectId: id } });
    if (!Number.isSafeInteger(number) || number < 1 || number > outline.targetChapters)
      throw new BadRequestException('章号不在目标范围内');
    const book = await this.book(id);
    const previous = [];
    for (const chapter of book?.chapters.filter((c) => c.chapterNumber < number) ?? []) {
      if (!chapter.confirmedHash || chapter.stale || chapter.confirmedHash !== chapter.observedHash)
        throw new BadRequestException(`第 ${chapter.chapterNumber} 章尚未接受或需复核`);
      const summary = chapter.summaries.find(
        (s) =>
          s.status === 'done' &&
          s.acceptedAt &&
          s.sourceHash === chapter.confirmedHash &&
          s.prefixFingerprint === chapter.prefixFingerprint,
      );
      if (!summary?.data) throw new BadRequestException(`第 ${chapter.chapterNumber} 章摘要无效`);
      previous.push({
        chapterNumber: chapter.chapterNumber,
        hash: chapter.confirmedHash,
        data: ProseSummaryOutputSchema.parse(JSON.parse(summary.data)),
      });
    }
    // 旧接受证据的版本盐继续沿用；只读正文记录，不再依赖历史节拍产物。
    const legacyRevision =
      book?.chapters.find((c) => c.chapterNumber === number)?.beatChapterRevision ?? 0;
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const answers = QuestionnaireAnswersSchema.parse(JSON.parse(project.answers));
    const fingerprint = proseDependencyFingerprint(
      outline.revision,
      legacyRevision,
      previous,
      answers.writingStyle,
    );
    return {
      context,
      previous,
      fingerprint,
      outlineRevision: outline.revision,
      legacyRevision,
    };
  }
  private report(row: Chapter, fingerprint?: string): ProseReviewReport | null {
    const report = row.reviews.find(
      (r) =>
        r.status === 'done' &&
        r.sourceHash === row.observedHash &&
        (!fingerprint || r.dependencyFingerprint === fingerprint),
    );
    if (!report?.data) return null;
    return ProseReviewReportSchema.parse(
      normalizeStoredReview({
        ...JSON.parse(report.data),
        id: report.id,
        sourceHash: report.sourceHash,
        dependencyFingerprint: report.dependencyFingerprint,
        promptVersion: report.promptVersion,
        verdict: report.verdict,
        overrideReason: report.overrideReason,
      }),
    );
  }
  async savedSnapshot(id: string, number: number) {
    const revision = await this.prisma.proseRevision.findFirst({
      where: { projectId: id, chapterNumber: number, applyPhase: 'committed' },
      orderBy: { appliedAt: 'desc' },
    });
    if (revision?.content && revision.resultHash === proseHash(revision.content))
      return { content: revision.content, hash: revision.resultHash };
    const initial = await this.prisma.proseOperation.findFirst({
      where: { projectId: id, chapterNumber: number, kind: 'initial', phase: 'committed' },
    });
    if (initial?.candidatePath && initial.resultHash) {
      const file = await this.files.readStored(id, initial.candidatePath);
      if (file.status === 'valid' && file.content && file.hash === initial.resultHash)
        return { content: file.content, hash: file.hash };
    }
    return null;
  }
  async detail(id: string): Promise<ProseDetail> {
    await this.project(id);
    await this.reconcile(id);
    const book = await this.book(id);
    const chapters = [];
    for (const row of book?.chapters ?? []) {
      if (row.chapterNumber > book!.targetChapters) continue;
      const file = await this.files.read(id, row.chapterNumber);
      const report =
        row.stale || file.hash !== row.observedHash
          ? null
          : this.report(row, row.prefixFingerprint ?? undefined);
      const summary = report
        ? row.summaries.find(
            (s) =>
              s.status === 'done' &&
              s.reviewId === report.id &&
              s.sourceHash === file.hash &&
              s.prefixFingerprint === report.dependencyFingerprint,
          )
        : undefined;
      const operations = await this.prisma.proseOperation.findMany({
        where: {
          projectId: id,
          chapterNumber: row.chapterNumber,
          kind: 'candidate',
          phase: 'committed',
        },
      });
      // 候选内容由操作生成，读取仍经安全路径校验。
      const candidates = [];
      for (const op of operations)
        if (op.candidatePath && op.resultHash) {
          const { readFile } = await import('node:fs/promises');
          const path = await this.files.path(id, op.candidatePath);
          let content = '';
          let fileStatus: 'valid' | 'missing' | 'unreadable' = 'valid';
          let error: string | null = null;
          try {
            content = await readFile(path, 'utf8');
          } catch (cause) {
            fileStatus =
              (cause as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable';
            error =
              fileStatus === 'missing'
                ? '候选稿文件已删除或移动，正文和审核仍可正常使用'
                : '候选稿暂时无法读取，请检查文件权限';
          }
          candidates.push({
            operationId: op.id,
            path,
            content,
            fileStatus,
            error,
            sourceHash: op.resultHash,
          });
        }
      chapters.push({
        chapterNumber: row.chapterNumber,
        path: await this.files.path(id, row.relativePath),
        content: file.content,
        revision: row.revision,
        observedHash: file.hash,
        confirmedHash: row.confirmedHash,
        generationStatus: row.generationStatus,
        reviewStatus: row.reviewStatus,
        fileStatus: file.status,
        machineStep:
          row.reviewStatus === 'confirmed' && summary?.acceptedAt
            ? 'done'
            : file.status !== 'valid'
              ? 'generate'
              : !report
                ? 'ai_review'
                : !summary
                  ? 'summary'
                  : 'human_accept',
        report,
        summary: summary?.data
          ? {
              id: summary.id,
              reviewId: summary.reviewId,
              sourceHash: summary.sourceHash,
              dependencyFingerprint: summary.prefixFingerprint,
              data: ProseSummaryOutputSchema.parse(JSON.parse(summary.data)),
              accepted: Boolean(summary.acceptedAt),
            }
          : null,
        candidates,
        activeRevision: await this.prisma.proseRevision
          .findFirst({
            where: {
              projectId: id,
              chapterNumber: row.chapterNumber,
              status: { not: 'discarded' },
            },
            orderBy: { createdAt: 'desc' },
          })
          .then((r) =>
            r
              ? {
                  ...r,
                  suggestions: JSON.parse(r.suggestionsData),
                  suggestionResponses: JSON.parse(r.responsesData),
                  changes: JSON.parse(r.changesData),
                }
              : null,
          ),
        previousReadyRevision: await this.prisma.proseRevision
          .findFirst({
            where: { projectId: id, chapterNumber: row.chapterNumber, status: 'ready' },
            orderBy: { createdAt: 'desc' },
          })
          .then((r) =>
            r
              ? {
                  ...r,
                  suggestions: JSON.parse(r.suggestionsData),
                  suggestionResponses: JSON.parse(r.responsesData),
                  changes: JSON.parse(r.changesData),
                }
              : null,
          ),
        canRestore:
          file.status !== 'valid' && Boolean(await this.savedSnapshot(id, row.chapterNumber)),
        error: row.error,
        stale: row.stale,
      });
    }
    const accepted = chapters.filter((c) => c.machineStep === 'done').length;
    const detail = ProseDetailSchema.parse({
      directory: await this.files.path(id),
      revision: book?.revision ?? 0,
      targetChapters: book?.targetChapters ?? 1,
      acceptedChapters: accepted,
      completed: Boolean(book && accepted === book.targetChapters),
      blockingReason: chapters.find((c) => c.machineStep !== 'done')?.error ?? null,
      chapters,
    });
    const project = await this.project(id);
    if (project.status !== 'running' || executionContext.getStore()?.runId === project.runId) {
      const premise = await this.prisma.premise.findUnique({ where: { projectId: id } });
      let introduction = '';
      if (premise?.data) {
        try {
          const data: unknown = JSON.parse(premise.data);
          if (
            data &&
            typeof data === 'object' &&
            'logline' in data &&
            typeof data.logline === 'string'
          )
            introduction = data.logline;
        } catch {
          /* 简介投影不影响正文权威数据。 */
        }
      }
      await this.files.projection(
        id,
        'book.md',
        `# ${project.title}\n\n${introduction}\n\n` +
          detail.chapters
            .map(
              (c) =>
                `- [第 ${c.chapterNumber} 章](chapters/${String(c.chapterNumber).padStart(3, '0')}.md)`,
            )
            .join('\n'),
      );

      for (const chapter of detail.chapters) {
        if (chapter.report) {
          const stored = book?.chapters
            .find((c) => c.chapterNumber === chapter.chapterNumber)
            ?.reviews.find((r) => r.id === chapter.report!.id);
          const original: unknown = stored?.data ? JSON.parse(stored.data) : null;
          // 已有历史文件保留原样；缺失时仍可从旧数据库内容重建。
          if (hasLegacyEvidence(original)) {
            await this.files.create(
              id,
              `reviews/${chapter.chapterNumber}-${chapter.report.id}.json`,
              JSON.stringify(original, null, 2),
            );
          } else
            await this.files.projection(
              id,
              `reviews/${chapter.chapterNumber}-${chapter.report.id}.json`,
              JSON.stringify(chapter.report, null, 2),
            );
        }
        if (chapter.summary)
          await this.files.projection(
            id,
            `summaries/${String(chapter.chapterNumber).padStart(3, '0')}.json`,
            JSON.stringify(chapter.summary, null, 2),
          );
      }
    }
    return detail;
  }
  private async verify(id: string, number: number, hash: string, fingerprint: string) {
    await this.reconcile(id);
    const file = await this.files.read(id, number);
    const deps = await this.dependencies(id, number);
    if (file.hash !== hash || deps.fingerprint !== fingerprint)
      throw new ConflictException('正文或前文依赖已变化，请重新审核');
  }
  private async call<T>(
    id: string,
    number: number,
    purpose: string,
    invoke: (traceId: string) => Promise<T>,
  ): Promise<T> {
    const traceId = randomUUID();
    try {
      return await invoke(traceId);
    } finally {
      const usage = this.usage.get(traceId);
      if (usage) {
        const writeUsage = async (tx: Prisma.TransactionClient) => {
          const inserted = await tx.proseUsage.createMany({
            data: [
              {
                traceId,
                projectId: id,
                chapterNumber: number,
                purpose,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
              },
            ],
          });
          if (inserted.count) {
            await tx.project.update({
              where: { id },
              data: {
                promptTokens: { increment: usage.promptTokens },
                completionTokens: { increment: usage.completionTokens },
              },
            });
            await tx.proseChapter.updateMany({
              where: { book: { projectId: id }, chapterNumber: number },
              data: {
                promptTokens: { increment: usage.promptTokens },
                completionTokens: { increment: usage.completionTokens },
              },
            });
          }
        };
        // 已发生用量与正文发布分开记账：超时后仍可记录，迟到内容仍由执行权检查拒绝。
        if (purpose === 'revision')
          await this.prisma.$transaction(async (tx) => {
            const project = await tx.project.findFirst({ where: { id, deletedAt: null } });
            if (project) await writeUsage(tx);
          });
        else await this.commit(id, writeUsage);
      }
    }
  }
  private render(name: string, data: { answers?: unknown; [key: string]: unknown }) {
    const text = JSON.stringify(data);
    if (text.length > (this.config.get<number>('PROSE_CONTEXT_CHARS') ?? 180000))
      throw new BadRequestException(
        '正文审核上下文超过预算：未截断本章或前文摘要，请提高 PROSE_CONTEXT_CHARS',
      );
    const version = proseTemplates.find((template) => template.name === name)!.version;
    const selection =
      data.answers === undefined
        ? undefined
        : QuestionnaireAnswersSchema.parse(data.answers).writingStyle;
    return this.prompts.render(name, version, {
      data: text,
      writingStyle:
        name === 'prose-summary'
          ? ''
          : renderWritingStyle(selection, name === 'prose-review' ? 'review' : 'prose'),
    });
  }
  async process(id: string, number?: number, candidate = false) {
    if (number !== undefined && !ProseChapterNumberSchema.safeParse(number).success)
      throw new BadRequestException('章号必须为安全范围内的正整数');
    if (candidate) throw new BadRequestException('候选稿功能已下线，请使用按建议修改');
    try {
      await this.processInner(id, number, candidate);
    } catch (error) {
      const book = await this.book(id);
      const row =
        number !== undefined
          ? book?.chapters.find((c) => c.chapterNumber === number)
          : book?.chapters.find((c) => c.reviewStatus !== 'confirmed' || c.stale);
      if (row)
        await this.commit(id, async (tx) => {
          await tx.proseChapter.update({
            where: { id: row.id },
            data: { error: error instanceof Error ? error.message : '正文操作失败' },
          });
        });
      throw error;
    }
  }
  private async processInner(id: string, number?: number, candidate = false) {
    const project = await this.ensure(id);
    await this.reconcile(id);
    const book = (await this.book(id))!;
    const activeChapters = book.chapters.filter((c) => c.chapterNumber <= book.targetChapters);
    const row =
      number !== undefined
        ? activeChapters.find((c) => c.chapterNumber === number)
        : activeChapters.find((c) => c.reviewStatus !== 'confirmed' || c.stale);
    if (!row) {
      if (number !== undefined) throw new BadRequestException('章号不在目标范围内');
      return;
    }
    const n = row.chapterNumber;
    const deps = await this.dependencies(id, n);
    let file = await this.files.read(id, n);
    if (
      candidate ||
      (file.status === 'missing' && !row.observedHash && row.generationStatus === 'pending')
    ) {
      const op = await this.prisma.proseOperation.create({
        data: {
          projectId: id,
          runId: executionContext.getStore()?.runId ?? '',
          kind: candidate ? 'candidate' : 'initial',
          chapterNumber: n,
          baseHash: file.hash,
          dependencyFingerprint: deps.fingerprint,
        },
      });
      const result = await this.call(id, n, 'draft', async (traceId) =>
        this.llm.complete(
          [
            {
              role: 'user',
              content: this.render('prose-draft', {
                answers: JSON.parse(project.answers),
                context: {
                  ...deps.context,
                  outline: {
                    plan: deps.context.outline!.plan,
                    chapters: deps.context.outline!.chapters.filter((c) => c.number === n),
                  },
                },
                chapterNumber: n,
                previous: deps.previous.map((p, index) =>
                  index >= deps.previous.length - 5
                    ? p
                    : {
                        ...p,
                        data: {
                          events: p.data.events.slice(0, 2),
                          characterChanges: [],
                          foreshadowing: p.data.foreshadowing,
                          continuity: p.data.continuity.slice(0, 300),
                        },
                      },
                ),
                contextSelection: {
                  recentFullSummaries: 5,
                  olderEventLimit: 2,
                  olderContinuityCharacters: 300,
                },
                targetWords:
                  this.config.get<number>('PROSE_TARGET_WORDS_SHORT') ??
                  (project.length === 'short' ? 2000 : 3000),
                previousEnding:
                  n > 1 ? (await this.files.read(id, n - 1)).content?.slice(-3000) : '',
              }),
            },
          ],
          { traceId, usage: 'draft', maxTokens: 8192 },
        ),
      );
      if (!result.content.trim()) throw new BadRequestException('正文输出为空');
      const path = `drafts/${n}-${op.id}.md`;
      await this.files.create(id, path, result.content);
      await this.commit(id, async (tx) => {
        await tx.proseOperation.update({
          where: { id: op.id },
          data: {
            kind: 'candidate',
            candidatePath: path,
            resultHash: proseHash(result.content),
            phase: 'committed',
          },
        });
      });
      if (result.finishReason === 'length')
        throw new BadRequestException('正文输出被截断，请重试生成');
      await this.verify(id, n, file.hash ?? '', deps.fingerprint).catch(async (error) => {
        if (file.status !== 'missing' || (await this.files.read(id, n)).status !== 'missing')
          throw error;
        if ((await this.dependencies(id, n)).fingerprint !== deps.fingerprint) throw error;
      });
      if (!candidate) {
        await this.commit(id, async (tx) => {
          await tx.proseOperation.update({
            where: { id: op.id },
            data: { kind: 'initial', phase: 'published' },
          });
        });
        const created = await this.files.create(id, row.relativePath, result.content);
        if (!created) {
          await this.commit(id, async (tx) => {
            await tx.proseOperation.update({
              where: { id: op.id },
              data: { kind: 'candidate', phase: 'committed' },
            });
          });
          throw new ConflictException('正文文件已变化，未覆盖现有正文，请重新加载');
        }
      }
      await this.commit(id, async (tx) => {
        await tx.proseOperation.update({ where: { id: op.id }, data: { phase: 'committed' } });
      });
      await this.reconcile(id);
      if (candidate) return;
      file = await this.files.read(id, n);
    }
    if (file.status !== 'valid' || !file.hash || !file.content)
      throw new BadRequestException(`第 ${n} 章文件 ${file.status}，请恢复已保存正文后重试`);
    let current = (await this.book(id))!.chapters.find((c) => c.chapterNumber === n)!;
    let report = this.report(current, deps.fingerprint);
    if (!report) {
      const review = await this.prisma.proseReview.create({
        data: {
          chapterId: row.id,
          sourceHash: file.hash,
          dependencyFingerprint: deps.fingerprint,
          promptVersion: proseTemplates.find((template) => template.name === 'prose-review')!
            .version,
          status: 'generating',
        },
      });
      // 在校验前保留模型返回对象，避免证据或结构校验失败时丢失排查内容。
      let returnedOutput: unknown = null;
      try {
        returnedOutput = await this.call(id, n, 'review', (traceId) =>
          this.llm.completeStructured(
            ProseReviewOutputSchema,
            [
              {
                role: 'user',
                content: this.render('prose-review', {
                  answers: JSON.parse(project.answers),
                  context: {
                    ...deps.context,
                    outline: {
                      plan: deps.context.outline!.plan,
                      chapters: deps.context.outline!.chapters.filter((c) => c.number === n),
                    },
                  },
                  chapterNumber: n,
                  previous: deps.previous,
                  content: file.content,
                }),
              },
            ],
            { traceId, usage: 'reasoning' },
          ),
        );
        const output = ProseReviewOutputSchema.parse(returnedOutput);
        for (const [index, issue] of output.issues.entries()) {
          for (const [quoteIndex, quote] of issue.evidence.entries()) {
            if (!file.content.includes(quote))
              throw new BadRequestException(
                `审核证据不在本章原文中（issues[${index}].evidence[${quoteIndex}]）`,
              );
          }
          if (issue.previousEvidence) {
            const previous = deps.previous.find(
              (p) => p.chapterNumber === issue.previousEvidence!.chapterNumber,
            );
            const fields = previous ? Object.values(previous.data).flat() : [];
            for (const [quoteIndex, quote] of issue.previousEvidence.quotes.entries()) {
              if (!previous || !fields.some((field) => field.includes(quote)))
                throw new BadRequestException(
                  `跨章审核证据不在前文摘要中（issues[${index}].previousEvidence.quotes[${quoteIndex}]）`,
                );
            }
          }
        }
        await this.verify(id, n, file.hash, deps.fingerprint);
        const data = { ...output, coveredChapters: deps.previous.map((p) => p.chapterNumber) };
        await this.commit(id, async (tx) => {
          await tx.proseReview.update({
            where: { id: review.id },
            data: {
              status: 'done',
              verdict: proseVerdictFor(output.issues),
              data: JSON.stringify(data),
            },
          });
          await tx.proseChapter.update({
            where: { id: row.id },
            data: { prefixFingerprint: deps.fingerprint, stale: false, error: null },
          });
        });
        await this.files.projection(
          id,
          `reviews/${n}-${review.id}.json`,
          JSON.stringify(data, null, 2),
        );
      } catch (error) {
        const diagnostic = ProseFailedReviewSchema.parse({
          formatVersion: 1,
          status: 'failed',
          reviewId: review.id,
          chapterNumber: n,
          sourceHash: review.sourceHash,
          dependencyFingerprint: review.dependencyFingerprint,
          promptVersion: review.promptVersion,
          failedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : '审核失败',
          output: returnedOutput ?? null,
        });
        // 先保存数据库诊断，文件投影失败仍可排查；沿用运行提交保护。
        await this.commit(id, async (tx) => {
          await tx.proseReview.update({
            where: { id: review.id },
            data: {
              status: 'failed',
              verdict: null,
              error: diagnostic.error,
              data: JSON.stringify(diagnostic),
            },
          });
        });
        try {
          await this.files.projection(
            id,
            `reviews/${n}-${review.id}-failed.json`,
            JSON.stringify(diagnostic, null, 2),
          );
        } catch (projectionError) {
          const message = `${diagnostic.error}；失败审核报告文件写入失败，诊断已保存在数据库`;
          await this.commit(id, async (tx) => {
            await tx.proseReview.update({ where: { id: review.id }, data: { error: message } });
          });
          throw new InternalServerErrorException(message, { cause: projectionError });
        }
        throw error;
      }
      current = (await this.book(id))!.chapters.find((c) => c.chapterNumber === n)!;
      report = this.report(current, deps.fingerprint);
    }
    if (!report || (report.verdict !== 'accept' && !report.overrideReason)) return;
    const summary = current.summaries.find(
      (s) =>
        s.status === 'done' &&
        s.sourceHash === file.hash &&
        s.reviewId === report!.id &&
        s.prefixFingerprint === deps.fingerprint,
    );
    if (!summary) {
      const pending = await this.prisma.proseSummary.create({
        data: {
          chapterId: row.id,
          sourceHash: file.hash,
          prefixFingerprint: deps.fingerprint,
          reviewId: report.id,
          status: 'generating',
        },
      });
      try {
        const data = ProseSummaryGenerationSchema.parse(
          await this.call(id, n, 'summary', (traceId) =>
            this.llm.completeStructured(
              ProseSummaryGenerationSchema,
              [
                {
                  role: 'user',
                  content: this.render('prose-summary', {
                    content: file.content,
                    chapterNumber: n,
                  }),
                },
              ],
              { traceId, usage: 'draft' },
            ),
          ),
        );
        await this.verify(id, n, file.hash, deps.fingerprint);
        await this.commit(id, async (tx) => {
          await tx.proseSummary.update({
            where: { id: pending.id },
            data: { data: JSON.stringify(data), status: 'done' },
          });
        });
        await this.files.projection(
          id,
          `summaries/${String(n).padStart(3, '0')}.json`,
          JSON.stringify({ accepted: false, sourceHash: file.hash, data }, null, 2),
        );
      } catch (error) {
        await this.commit(id, async (tx) => {
          await tx.proseSummary.update({
            where: { id: pending.id },
            data: { status: 'failed', error: error instanceof Error ? error.message : '摘要失败' },
          });
        });
        throw error;
      }
    }
    await this.commit(id, async (tx) => {
      await tx.proseChapter.update({ where: { id: row.id }, data: { error: null } });
    });
  }
  async accept(id: string, n: number, body: ConfirmProseBody) {
    await this.reconcile(id);
    const deps = await this.dependencies(id, n);
    const row = (await this.book(id))?.chapters.find((c) => c.chapterNumber === n);
    if (!row || row.observedHash !== body.expectedHash || row.revision !== body.expectedRevision)
      throw new ConflictException('正文版本变化');
    const report = this.report(row, deps.fingerprint);
    const summary = row.summaries.find(
      (s) =>
        s.id === body.summaryId &&
        s.status === 'done' &&
        s.reviewId === body.reviewId &&
        s.sourceHash === row.observedHash &&
        s.prefixFingerprint === deps.fingerprint,
    );
    if (
      !report ||
      report.id !== body.reviewId ||
      (report.verdict !== 'accept' && !report.overrideReason) ||
      !summary
    )
      throw new BadRequestException('需要有效审核/覆盖授权及待接受摘要');
    await this.verify(id, n, body.expectedHash, deps.fingerprint);
    const previousAcceptance = await this.prisma.proseAcceptance.findUnique({
      where: {
        chapterId_reviewId_summaryId: {
          chapterId: row.id,
          reviewId: report.id,
          summaryId: summary.id,
        },
      },
    });
    if (
      previousAcceptance &&
      row.reviewStatus === 'confirmed' &&
      row.confirmedHash === body.expectedHash &&
      !row.stale &&
      summary.acceptedAt
    )
      return false;
    await this.commit(id, async (tx) => {
      await tx.proseAcceptance.upsert({
        where: {
          chapterId_reviewId_summaryId: {
            chapterId: row.id,
            reviewId: report.id,
            summaryId: summary.id,
          },
        },
        create: {
          chapterId: row.id,
          reviewId: report.id,
          summaryId: summary.id,
          sourceHash: body.expectedHash,
          dependencyFingerprint: deps.fingerprint,
          overrideReason: report.overrideReason,
        },
        update: {},
      });
      await tx.proseChapter.update({
        where: { id: row.id },
        data: {
          confirmedHash: body.expectedHash,
          reviewStatus: 'confirmed',
          stale: false,
          prefixFingerprint: deps.fingerprint,
          outlineRevision: deps.outlineRevision,
          beatChapterRevision: deps.legacyRevision,
        },
      });
      await tx.proseSummary.update({ where: { id: summary.id }, data: { acceptedAt: new Date() } });
    });
    await this.files.projection(
      id,
      `summaries/${String(n).padStart(3, '0')}.json`,
      JSON.stringify(
        { accepted: true, sourceHash: body.expectedHash, data: JSON.parse(summary.data!) },
        null,
        2,
      ),
    );
    return true;
  }
  async override(id: string, n: number, body: OverrideProseReviewBody) {
    await this.reconcile(id);
    const deps = await this.dependencies(id, n);
    const row = (await this.book(id))?.chapters.find((c) => c.chapterNumber === n);
    if (!row || row.observedHash !== body.expectedHash || row.revision !== body.expectedRevision)
      throw new ConflictException('正文版本变化');
    const report = this.report(row, deps.fingerprint);
    if (!report || report.id !== body.reviewId || report.verdict === 'accept')
      throw new BadRequestException('没有可覆盖的有效审核结论');
    await this.verify(id, n, body.expectedHash, deps.fingerprint);
    await this.commit(id, async (tx) => {
      await tx.proseReview.update({
        where: { id: report.id },
        data: { overrideReason: body.reason },
      });
    });
    await this.process(id, n);
  }
  async generate(_context: StageContext, _answers: QuestionnaireAnswers, id: string) {
    await this.process(id);
  }
  readonly node = async (state: PipelineState): Promise<Partial<PipelineState>> => {
    await this.commit(state.projectId, async (tx) => {
      await tx.project.update({ where: { id: state.projectId }, data: { currentStage: 'prose' } });
      const runId = executionContext.getStore()!.runId;
      await tx.stageRun.upsert({
        where: { projectId_runId_stage: { projectId: state.projectId, runId, stage: 'prose' } },
        create: { projectId: state.projectId, runId, stage: 'prose', status: 'generating' },
        update: { status: 'generating', error: null },
      });
    });
    await this.process(state.projectId);
    const detail = await this.detail(state.projectId);
    await this.commit(state.projectId, async (tx) => {
      const runId = executionContext.getStore()!.runId;
      await tx.stageRun.upsert({
        where: { projectId_runId_stage: { projectId: state.projectId, runId, stage: 'prose' } },
        create: {
          projectId: state.projectId,
          runId,
          stage: 'prose',
          status: detail.completed ? 'done' : 'pending',
        },
        update: {
          status: detail.completed ? 'done' : 'pending',
          stale: false,
          confirmedAt: detail.completed ? new Date() : null,
        },
      });
      if (detail.completed)
        await tx.proseBook.update({
          where: { projectId: state.projectId },
          data: { completedRevision: detail.revision, stale: false },
        });
    });
    if (!detail.completed)
      interrupt({
        target: 'prose',
        chapterNumber: detail.chapters.find((c) => c.machineStep !== 'done')?.chapterNumber,
      });
    return { currentStage: 'prose' };
  };
}
