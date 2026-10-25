import { normalizeStoredReview } from './stored-review.js';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ChapterBatchSchema,
  WritingStyleSelectionSchema,
  ProseReviewReportSchema,
  ProseSummaryOutputSchema,
  type BookDiagnostic,
} from '@rill/shared';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { ProseFilesService, proseHash } from './prose-files.service.js';
import { proseDependencyFingerprint } from './prose-fingerprint.js';

function storedJson(value: string | null) {
  try {
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}
const include = {
  outline: { include: { batches: true } },
  proseBook: {
    include: {
      chapters: {
        orderBy: { chapterNumber: 'asc' as const },
        include: { reviews: true, summaries: true, acceptances: true },
      },
    },
  },
  stageRuns: { orderBy: [{ updatedAt: 'desc' as const }, { createdAt: 'desc' as const }] },
};
export type ContentState = NonNullable<Awaited<ReturnType<ProseContentService['state']>>>;
@Injectable()
export class ProseContentService {
  constructor(
    private readonly prisma: PrismaService,
    readonly files: ProseFilesService,
  ) {}
  async state(id: string, db: Prisma.TransactionClient = this.prisma) {
    const p = await db.project.findFirst({ where: { id, deletedAt: null }, include });
    if (!p) throw new NotFoundException('项目不存在');
    return p;
  }
  fingerprint(p: ContentState) {
    return proseHash(JSON.stringify(p));
  }
  async read(id: string, through?: number) {
    const p = await this.state(id);
    const pending = await this.prisma.proseRevision.findFirst({
      where: { projectId: id, status: { in: ['applying', 'recovery_required'] } },
    });
    if (pending) throw new ConflictException('正文修改正在应用或恢复，请稍后重试');
    const outline = p.outline;
    const book = p.proseBook;
    const target = outline?.targetChapters ?? book?.targetChapters ?? 0;
    const outlines =
      outline?.batches
        .filter((b) => b.planRevision === outline.planRevision && b.status === 'done' && b.data)
        .flatMap((b) => ChapterBatchSchema.parse(JSON.parse(b.data!)).chapters) ?? [];
    const outlineStage = p.stageRuns.find((r) => r.stage === 'outline');
    const ordered = outlines.filter((c) => c.number <= target).sort((a, b) => a.number - b.number);
    const upstream = !!(
      outline &&
      !outline.stale &&
      outline.confirmedRevision === outline.revision &&
      ordered.length === target &&
      ordered.every((c, i) => c.number === i + 1) &&
      (!outlineStage || (outlineStage.status === 'done' && !outlineStage.stale))
    );
    const previous: Array<{ chapterNumber: number; hash: string; data: unknown }> = [];
    const chapters = [];
    let prefixValid = upstream;
    for (let n = 1; n <= Math.min(through ?? target, target); n++) {
      const row = book?.chapters.find((c) => c.chapterNumber === n);
      const file = await this.files.read(id, n);
      const fp = proseDependencyFingerprint(
        outline?.revision ?? 0,
        row?.beatChapterRevision ?? 0,
        previous,
        WritingStyleSelectionSchema.optional().parse(JSON.parse(p.answers).writingStyle),
      );
      const report = row?.reviews.find(
        (r) => r.status === 'done' && r.sourceHash === file.hash && r.dependencyFingerprint === fp,
      );
      const summary = row?.summaries.find(
        (s) =>
          s.status === 'done' &&
          s.acceptedAt &&
          s.sourceHash === file.hash &&
          s.prefixFingerprint === fp &&
          s.reviewId === report?.id,
      );
      const acceptance = row?.acceptances.find(
        (a) =>
          a.sourceHash === file.hash &&
          a.dependencyFingerprint === fp &&
          a.reviewId === report?.id &&
          a.summaryId === summary?.id,
      );
      const storedReport = storedJson(report?.data ?? null);
      const parsed =
        report && storedReport && typeof storedReport === 'object'
          ? ProseReviewReportSchema.safeParse(
              normalizeStoredReview({
                ...storedReport,
                id: report.id,
                sourceHash: report.sourceHash,
                dependencyFingerprint: report.dependencyFingerprint,
                promptVersion: report.promptVersion,
                verdict: report.verdict,
                overrideReason: report.overrideReason,
              }),
            )
          : null;
      const approved =
        report &&
        parsed?.success &&
        parsed.data.coveredChapters.length === n - 1 &&
        parsed.data.coveredChapters.every((value, index) => value === index + 1) &&
        (parsed.data.verdict === 'accept' ||
          (report.overrideReason?.trim() && acceptance?.overrideReason === report.overrideReason));
      const summaryData = ProseSummaryOutputSchema.safeParse(storedJson(summary?.data ?? null));
      const valid = !!(
        prefixValid &&
        row &&
        !row.stale &&
        !book?.stale &&
        file.status === 'valid' &&
        file.hash === row.confirmedHash &&
        file.hash === row.observedHash &&
        row.reviewStatus === 'confirmed' &&
        row.outlineRevision === outline?.revision &&
        row.prefixFingerprint === fp &&
        approved &&
        summary &&
        summaryData.success &&
        acceptance
      );
      const diagnostic: BookDiagnostic | null = valid
        ? null
        : {
            code: 'CHAPTER_NOT_ACCEPTED',
            chapterNumber: n,
            message: `第 ${n} 章：${file.status !== 'valid' ? `正文文件 ${file.status}` : !upstream ? '大纲未确认或已失效' : !prefixValid ? '前文需重新审核、接受' : '正文、审核、摘要或接受证据不匹配，请重新审核并接受'}`,
          };
      chapters.push({
        chapterNumber: n,
        title: outlines.find((c) => c.number === n)?.title ?? `第 ${n} 章`,
        source: file.content,
        hash: file.hash,
        accepted: valid,
        diagnostic,
      });
      if (valid && summary?.data)
        previous.push({
          chapterNumber: n,
          hash: file.hash!,
          data: summaryData.success ? summaryData.data : null,
        });
      prefixValid = valid;
    }
    if (this.fingerprint(await this.state(id)) !== this.fingerprint(p))
      throw new ConflictException('读取期间接受证据已变化，请刷新重试');
    return {
      state: p,
      stateFingerprint: this.fingerprint(p),
      target,
      outlineRevision: outline?.revision ?? 0,
      chapters,
    };
  }
}
