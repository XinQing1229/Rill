import { CoverService } from '../cover/cover.service.js';
import {
  ConflictException,
  Optional,
  Injectable,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  BookMetadataSchema,
  BookSettingsSchema,
  BookJobSchema,
  BookFormatSchema,
  BookPreviewSchema,
  type BookCopyMode,
  type BookDiagnostic,
  type BookDocument,
  type BookFormat,
  type CreateBookJobSchema,
  type SaveBookSettingsSchema,
} from '@rill/shared';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
import { ProseContentService } from '../prose/prose-content.service.js';
import { proseHash } from '../prose/prose-files.service.js';
import { prepareDocument, chapterHeading } from './book-content.js';
import { BookExportFilesService, bytesHash } from './book-export-files.service.js';
import { BOOK_EXTENSION, BOOK_MIME, renderBook } from './book-renderers.js';
const jobInclude = { snapshot: true, files: { orderBy: { format: 'asc' as const } } };
type JobRow = Prisma.BookExportJobGetPayload<{ include: typeof jobInclude }>;
const errorText = (e: unknown) => (e instanceof Error ? e.message : '导出失败');
@Injectable()
export class BookExportService implements OnModuleInit, OnModuleDestroy {
  private queue: Promise<void> = Promise.resolve();
  private active = new Map<string, Promise<void>>();
  private stopping = false;
  private cleaning = new Map<string, Promise<void>>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ProseContentService,
    private readonly files: BookExportFilesService,
    @Optional() private readonly covers?: CoverService,
  ) {}
  async project(id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('项目不存在');
    return p;
  }
  async settings(id: string) {
    await this.project(id);
    const [saved, premise, outline] = await Promise.all([
      this.prisma.bookExportSettings.findUnique({ where: { projectId: id } }),
      this.prisma.premise.findUnique({ where: { projectId: id } }),
      this.prisma.outline.findUnique({ where: { projectId: id }, include: { batches: true } }),
    ]);
    let initial: { title?: string; logline?: string } = {};
    if (premise?.data) {
      try {
        initial = JSON.parse(premise.data) as typeof initial;
      } catch {
        /* 空预填不影响创作。 */
      }
    }
    const data = BookMetadataSchema.parse(
      saved
        ? JSON.parse(saved.data)
        : {
            title: initial.title ?? '',
            author: '',
            introduction: initial.logline ?? '',
            chapterTitles: [],
          },
    );
    const { ChapterBatchSchema } = await import('@rill/shared');
    const chapters =
      outline?.batches
        .filter((b) => b.planRevision === outline.planRevision && b.status === 'done' && b.data)
        .flatMap((b) => ChapterBatchSchema.parse(JSON.parse(b.data!)).chapters)
        .sort((a, b) => a.number - b.number) ?? [];
    return BookSettingsSchema.parse({
      ...data,
      revision: saved?.revision ?? 0,
      outlineRevision: outline?.revision ?? 0,
      chapters: chapters.map((c) => {
        const override = data.chapterTitles.find((t) => t.chapterNumber === c.number);
        return {
          chapterNumber: c.number,
          title: override?.title ?? c.title,
          defaultTitle: c.title,
          needsCheck: !!override && override.outlineRevision !== outline?.revision,
        };
      }),
    });
  }
  async saveSettings(id: string, input: z.infer<typeof SaveBookSettingsSchema>) {
    await this.project(id);
    const data = BookMetadataSchema.parse(input);
    data.chapterTitles.sort((a, b) => a.chapterNumber - b.chapterNumber);
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.project.findFirst({ where: { id, deletedAt: null } })))
        throw new NotFoundException('项目不存在');
      const existing = await tx.bookExportSettings.findUnique({ where: { projectId: id } });
      if ((existing?.revision ?? 0) !== input.expectedRevision)
        throw new ConflictException('成书信息已变化，请刷新核对');
      const outline = await tx.outline.findUnique({ where: { projectId: id } });
      if (
        data.chapterTitles.some(
          (c) =>
            c.chapterNumber > (outline?.targetChapters ?? 0) ||
            c.outlineRevision !== outline?.revision,
        )
      )
        throw new ConflictException('大纲版本已变化，请重新核对章节标题');
      if (existing?.data === JSON.stringify(data)) return;
      if (existing)
        await tx.bookExportSettings.update({
          where: { projectId: id },
          data: { data: JSON.stringify(data), revision: { increment: 1 } },
        });
      else
        await tx.bookExportSettings.create({ data: { projectId: id, data: JSON.stringify(data) } });
    });
    return this.settings(id);
  }
  async prepare(id: string, through?: number) {
    const settings = await this.settings(id);
    const result = await this.content.read(id, through);
    const metadata = BookMetadataSchema.parse(settings);
    const docs: BookDocument[] = [];
    const diagnostics: BookDiagnostic[] = [];
    for (const c of result.chapters) {
      if (c.diagnostic) diagnostics.push(c.diagnostic);
      const title =
        settings.chapters.find((t) => t.chapterNumber === c.chapterNumber)?.title ?? c.title;
      if (settings.chapters.find((t) => t.chapterNumber === c.chapterNumber)?.needsCheck)
        diagnostics.push({
          code: 'TITLE_NEEDS_CHECK',
          message: `第 ${c.chapterNumber} 章展示标题需按新大纲核对`,
          chapterNumber: c.chapterNumber,
        });
      if (c.source !== null) {
        const parsed = prepareDocument(c.chapterNumber, title, c.title, c.source);
        docs.push(parsed.document);
        diagnostics.push(...parsed.diagnostics);
      }
    }
    if (!metadata.title.trim())
      diagnostics.push({ code: 'TITLE_REQUIRED', message: '请填写并保存成书书名' });
    if (!result.target) diagnostics.push({ code: 'NO_CHAPTERS', message: '请先完成大纲与正文' });
    let coverData: Awaited<ReturnType<CoverService['currentImage']>> = { revision: 0, cover: null };
    if (this.covers) {
      try {
        coverData = await this.covers.currentImage(id);
      } catch {
        diagnostics.push({
          code: 'COVER_UNAVAILABLE',
          message: '封面不可用，请重新上传、切换历史封面或删除',
        });
      }
    }
    const contentFingerprint = proseHash(
      JSON.stringify({
        metadata: {
          title: metadata.title,
          author: metadata.author,
          introduction: metadata.introduction,
        },
        chapters: docs.map((d) => [d.chapterNumber, d.title, d.sourceHash]),
        renderer: coverData.cover ? 'v2' : 'v1',
        ...(coverData.cover ? { cover: coverData.cover.asset.sha256 } : {}),
      }),
    );
    const evidenceFingerprint = proseHash(
      JSON.stringify({ state: result.stateFingerprint, settings: metadata }),
    );
    const previewToken = proseHash(JSON.stringify([contentFingerprint, evidenceFingerprint]));
    return {
      ...result,
      coverData,
      settings,
      metadata,
      docs,
      diagnostics,
      contentFingerprint,
      evidenceFingerprint,
      previewToken,
    };
  }
  async preview(id: string, number = 1, expected?: string) {
    const p = await this.prepare(id);
    if (expected && expected !== p.previewToken)
      throw new ConflictException('预览已过期，请重新预览');
    return BookPreviewSchema.parse({
      metadata: p.metadata,
      cover: p.coverData.cover?.asset ?? null,
      chapters: p.chapters.map((c) => ({
        chapterNumber: c.chapterNumber,
        title: p.docs.find((d) => d.chapterNumber === c.chapterNumber)?.title ?? c.title,
        accepted: c.accepted,
      })),
      selected: p.docs.find((c) => c.chapterNumber === number) ?? null,
      diagnostics: p.diagnostics,
      previewToken: p.diagnostics.length ? null : p.previewToken,
      contentFingerprint: p.contentFingerprint,
    });
  }
  async copy(id: string, number: number, mode: BookCopyMode) {
    const p = await this.prepare(id, number);
    const chapter = p.chapters.find((c) => c.chapterNumber === number);
    if (!chapter) throw new NotFoundException('章号不在目标范围内');
    const blockers = p.diagnostics.filter(
      (d) =>
        d.code !== 'TITLE_REQUIRED' &&
        d.code !== 'COVER_UNAVAILABLE' &&
        (d.code === 'CHAPTER_NOT_ACCEPTED' || d.chapterNumber === number) &&
        (mode !== 'markdown-source' ||
          !['UNSUPPORTED_MARKDOWN', 'UNSAFE_LINK', 'AMBIGUOUS_TITLE', 'TITLE_NEEDS_CHECK'].includes(
            d.code,
          )),
    );
    if (!chapter.accepted || blockers.length)
      throw new UnprocessableEntityException({
        message: blockers.map((d) => d.message).join('；') || '章节尚未接受',
        diagnostics: blockers,
      });
    const doc = p.docs.find((c) => c.chapterNumber === number)!;
    const text =
      mode === 'markdown-source'
        ? doc.source
        : mode === 'plain-body'
          ? doc.plain
          : `${chapterHeading(number, doc.title)}\n\n${doc.plain}`;
    return { text, sourceHash: doc.sourceHash, checkedAt: new Date().toISOString() };
  }
  private async row(id: string, jobId: string) {
    await this.project(id);
    const job = await this.prisma.bookExportJob.findFirst({
      where: { id: jobId, projectId: id },
      include: jobInclude,
    });
    if (!job) throw new NotFoundException('导出任务不存在');
    return job;
  }
  private view(job: JobRow, current?: string) {
    return BookJobSchema.parse({
      id: job.id,
      title: job.snapshot?.title ?? '准备内容',
      chapterCount: job.snapshot?.chapterCount ?? 0,
      status: job.status,
      error: job.error,
      snapshotId: job.snapshotId,
      contentFingerprint: job.snapshot?.contentFingerprint ?? null,
      versionStatus:
        !current || !job.snapshot
          ? 'unverifiable'
          : job.snapshot.contentFingerprint === current
            ? 'current'
            : 'historical',
      createdAt: job.createdAt.toISOString(),
      files: job.files.map((f) => ({
        format: f.format,
        status: f.status,
        size: f.size,
        error: f.error,
      })),
    });
  }
  private async current(id: string) {
    try {
      const p = await this.prepare(id);
      return p.chapters.every((c) => c.source !== null) && p.target > 0
        ? p.contentFingerprint
        : undefined;
    } catch {
      return undefined;
    }
  }
  async job(id: string, jobId: string) {
    return this.view(await this.row(id, jobId), await this.current(id));
  }
  async list(id: string, page: number) {
    await this.project(id);
    const [items, total, current] = await Promise.all([
      this.prisma.bookExportJob.findMany({
        where: { projectId: id },
        include: jobInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.prisma.bookExportJob.count({ where: { projectId: id } }),
      this.current(id),
    ]);
    return { items: items.map((j) => this.view(j, current)), total, page };
  }
  async create(id: string, input: z.infer<typeof CreateBookJobSchema>) {
    await this.project(id);
    const formats = [...input.formats].sort();
    const requestHash = proseHash(JSON.stringify({ previewToken: input.previewToken, formats }));
    const existing = await this.prisma.bookExportJob.findUnique({
      where: { projectId_requestId: { projectId: id, requestId: input.requestId } },
      include: jobInclude,
    });
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new ConflictException('同一请求标识不能绑定不同参数');
      return this.view(existing);
    }
    const p = await this.prepare(id);
    if (p.diagnostics.length)
      throw new UnprocessableEntityException({
        message: p.diagnostics.map((d) => d.message).join('；'),
        diagnostics: p.diagnostics,
      });
    if (p.previewToken !== input.previewToken) throw new ConflictException('预览已过期，请刷新');
    const job = await this.prisma.$transaction(async (tx) => {
      if (!(await tx.project.findFirst({ where: { id, deletedAt: null } })))
        throw new NotFoundException('项目不存在');
      const j = await tx.bookExportJob.upsert({
        where: { projectId_requestId: { projectId: id, requestId: input.requestId } },
        update: {},
        create: {
          projectId: id,
          requestId: input.requestId,
          requestHash,
          previewToken: input.previewToken,
          formats: JSON.stringify(formats),
          files: { create: formats.map((format) => ({ format })) },
        },
        include: jobInclude,
      });
      if (j.requestHash !== requestHash) throw new ConflictException('请求参数冲突');
      return j;
    });
    this.enqueue(job.id);
    return this.view(job, p.contentFingerprint);
  }
  private enqueue(jobId: string) {
    if (this.active.has(jobId) || this.stopping) return;
    const pending = this.queue.then(() => this.run(jobId)).catch(() => undefined);
    this.active.set(jobId, pending);
    this.queue = pending.finally(() => {
      if (this.active.get(jobId) === pending) this.active.delete(jobId);
    });
  }
  private async guard(jobId: string, token: string) {
    const row = await this.prisma.bookExportJob.findFirst({
      where: {
        id: jobId,
        token,
        status: { in: ['preparing', 'generating'] },
        project: { deletedAt: null },
      },
    });
    if (!row || this.stopping) throw new ConflictException('任务执行权已变化');
  }
  private async run(jobId: string) {
    const token = randomUUID();
    const acquired = await this.prisma.bookExportJob.updateMany({
      where: {
        id: jobId,
        token: null,
        status: { in: ['preparing', 'generating'] },
        project: { deletedAt: null },
      },
      data: { token },
    });
    if (!acquired.count) return;
    let job = await this.prisma.bookExportJob.findUniqueOrThrow({
      where: { id: jobId },
      include: jobInclude,
    });
    const guard = () => this.guard(jobId, token);
    try {
      if (!job.snapshot) {
        const prepareSnapshot = async () => {
          const p = await this.prepare(job.projectId);
          if (p.diagnostics.length || p.previewToken !== job.previewToken)
            throw new ConflictException(
              p.diagnostics.map((d) => d.message).join('；') || '预览已过期，请重新发起',
            );
          const file = await this.files.snapshot(
            job.projectId,
            job.id,
            {
              version: 2,
              rendererVersion: 'v2',
              cover: p.coverData.cover
                ? {
                    path:
                      p.coverData.cover.row.mimeType === 'image/jpeg'
                        ? 'snapshot/cover/cover.jpg'
                        : 'snapshot/cover/cover.png',
                    sha256: p.coverData.cover.asset.sha256,
                    mimeType: p.coverData.cover.asset.mimeType,
                    width: p.coverData.cover.asset.width,
                    height: p.coverData.cover.asset.height,
                  }
                : null,
              metadata: p.metadata,
              contentFingerprint: p.contentFingerprint,
              evidenceFingerprint: p.evidenceFingerprint,
            },
            p.docs,
            guard,
            p.coverData.cover?.data,
          );
          await this.prisma.$transaction(async (tx) => {
            const state = await this.content.state(job.projectId, tx);
            const saved = await tx.bookExportSettings.findUnique({
              where: { projectId: job.projectId },
            });
            if (
              this.content.fingerprint(state) !== p.stateFingerprint ||
              (saved?.revision ?? 0) !== p.settings.revision
            )
              throw new ConflictException('准备期间正文证据或成书配置已变化');
            const coverState = await tx.projectCoverState.findUnique({
              where: { projectId: job.projectId },
            });
            if ((coverState?.revision ?? 0) !== p.coverData.revision)
              throw new ConflictException('准备期间封面已变化，请重新预览');
            const owned = await tx.bookExportJob.findFirst({
              where: { id: jobId, token, status: 'preparing' },
            });
            if (!owned) throw new ConflictException('任务已暂停或删除');
            const snapshot = await tx.bookExportSnapshot.create({
              data: {
                projectId: job.projectId,
                contentFingerprint: p.contentFingerprint,
                evidenceFingerprint: p.evidenceFingerprint,
                manifestPath: file.path,
                manifestHash: file.hash,
                title: p.metadata.title,
                chapterCount: p.docs.length,
              },
            });
            await tx.bookExportJob.update({
              where: { id: jobId },
              data: { snapshotId: snapshot.id, status: 'generating' },
            });
          });
          job = await this.prisma.bookExportJob.findUniqueOrThrow({
            where: { id: jobId },
            include: jobInclude,
          });
        };
        if (this.covers) await this.covers.locked(job.projectId, prepareSnapshot);
        else await prepareSnapshot();
      }
      const { manifest, docs, cover } = await this.files.load(
        job.projectId,
        job.id,
        job.snapshot!.manifestHash,
      );
      for (const file of job.files) {
        if (!['pending', 'generating'].includes(file.status)) continue;
        await guard();
        const claimedFile = await this.prisma.bookExportFile.updateMany({
          where: {
            id: file.id,
            job: { token, status: 'generating', project: { deletedAt: null } },
          },
          data: { status: 'generating', attempts: { increment: 1 }, error: null },
        });
        if (!claimedFile.count) throw new ConflictException('任务执行权已变化');
        try {
          const format = BookFormatSchema.parse(file.format);
          const data = await renderBook(
            format,
            manifest.metadata,
            docs,
            manifest.contentFingerprint,
            cover ? { data: cover, mimeType: manifest.cover!.mimeType } : undefined,
          );
          const published = await this.files.write(
            job.projectId,
            job.id,
            `files/book.${BOOK_EXTENSION[format]}`,
            data,
            guard,
          );
          await this.files.write(
            job.projectId,
            job.id,
            `files/${format}.receipt.json`,
            JSON.stringify({ token, fingerprint: manifest.contentFingerprint, ...published }),
            guard,
          );
          await this.prisma.$transaction(async (tx) => {
            if (
              !(await tx.bookExportJob.findFirst({
                where: { id: jobId, token, status: 'generating', project: { deletedAt: null } },
              }))
            )
              throw new ConflictException('执行权已变化');
            await tx.bookExportFile.update({
              where: { id: file.id },
              data: {
                status: 'succeeded',
                path: published.path,
                hash: published.hash,
                size: published.size,
                error: null,
              },
            });
          });
        } catch (e) {
          await guard();
          await this.prisma.bookExportFile.updateMany({
            where: {
              id: file.id,
              job: { token, status: 'generating', project: { deletedAt: null } },
            },
            data: { status: 'failed', error: errorText(e) },
          });
        }
      }
      await guard();
      const all = await this.prisma.bookExportFile.findMany({ where: { jobId } });
      const success = all.filter((f) => f.status === 'succeeded').length;
      await this.prisma.bookExportJob.updateMany({
        where: { id: jobId, token, status: 'generating', project: { deletedAt: null } },
        data: {
          token: null,
          status: success === all.length ? 'succeeded' : success ? 'partial_failed' : 'failed',
          error: success === all.length ? null : '部分或全部格式生成失败，可单独重试',
        },
      });
    } catch (e) {
      if (this.stopping) {
        await this.prisma.bookExportJob.updateMany({
          where: { id: jobId, token },
          data: { token: null },
        });
        return;
      }
      await this.prisma.bookExportJob.updateMany({
        where: {
          id: jobId,
          token,
          status: { in: ['preparing', 'generating'] },
          project: { deletedAt: null },
        },
        data: { token: null, status: 'failed', error: errorText(e) },
      });
    }
  }
  async retry(id: string, jobId: string, formats: BookFormat[]) {
    const job = await this.row(id, jobId);
    if (!job.snapshot || !['failed', 'partial_failed', 'succeeded'].includes(job.status))
      throw new ConflictException('当前任务不可重试，请重新发起导出');
    await this.files.load(id, jobId, job.snapshot.manifestHash);
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.bookExportJob.updateMany({
        where: { id: jobId, status: job.status, token: null, project: { deletedAt: null } },
        data: { status: 'generating', error: null },
      });
      if (!changed.count) throw new ConflictException('任务状态已变化');
      for (const format of formats) {
        const f = job.files.find((f) => f.format === format);
        if (!f || f.status !== 'failed') throw new ConflictException('只能重试失败或不可用的格式');
        await tx.bookExportFile.update({
          where: { id: f.id },
          data: { status: 'pending', error: null },
        });
      }
    });
    this.enqueue(jobId);
    return this.job(id, jobId);
  }
  async download(id: string, jobId: string, format: BookFormat) {
    const job = await this.row(id, jobId);
    const f = job.files.find((f) => f.format === format);
    if (
      !job.snapshot ||
      ['deleting', 'delete_failed'].includes(job.status) ||
      f?.status !== 'succeeded' ||
      !f.hash
    )
      throw new NotFoundException('导出文件不可用');
    let data: Buffer;
    try {
      data = await this.files.read(id, jobId, `files/book.${BOOK_EXTENSION[format]}`);
      if (bytesHash(data) !== f.hash || data.length !== f.size) throw new Error('文件损坏');
    } catch {
      await this.prisma.bookExportFile.update({
        where: { id: f.id },
        data: { status: 'failed', error: '文件缺失或损坏，可基于原快照恢复' },
      });
      await this.prisma.bookExportJob.updateMany({
        where: { id: jobId, status: { in: ['succeeded', 'partial_failed', 'failed'] } },
        data: {
          status: job.files.some((other) => other.id !== f.id && other.status === 'succeeded')
            ? 'partial_failed'
            : 'failed',
        },
      });
      throw new NotFoundException('文件缺失或损坏，请重试该格式');
    }
    const title =
      Array.from(job.snapshot.title)
        .map((c) =>
          c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '/' || c === '\\' ? '_' : c,
        )
        .join('')
        .slice(0, 100) || 'book';
    return { data, mime: BOOK_MIME[format], filename: `${title}.${BOOK_EXTENSION[format]}` };
  }
  async remove(id: string, jobId: string) {
    await this.row(id, jobId);
    const marked = await this.prisma.bookExportJob.updateMany({
      where: { id: jobId, projectId: id, project: { deletedAt: null } },
      data: { status: 'deleting', token: null },
    });
    if (!marked.count) throw new NotFoundException('导出任务不可达');
    this.startCleanup(id, jobId);
    return { id: jobId, status: 'deleting' };
  }
  private startCleanup(id: string, jobId: string) {
    if (this.cleaning.has(jobId)) return;
    const operation = this.cleanup(id, jobId).finally(() => this.cleaning.delete(jobId));
    this.cleaning.set(jobId, operation);
  }
  private async cleanup(id: string, jobId: string) {
    await this.active.get(jobId);
    try {
      await this.files.remove(id, jobId);
      await this.prisma.$transaction(async (tx) => {
        const j = await tx.bookExportJob.findUnique({ where: { id: jobId } });
        if (!j) return;
        await tx.bookExportJob.delete({ where: { id: jobId } });
        if (j.snapshotId) await tx.bookExportSnapshot.delete({ where: { id: j.snapshotId } });
      });
    } catch (e) {
      await this.prisma.bookExportJob.updateMany({
        where: { id: jobId },
        data: { status: 'delete_failed', error: errorText(e) },
      });
    }
  }
  async pauseProject(id: string) {
    const jobs = await this.prisma.bookExportJob.findMany({ where: { projectId: id } });
    await this.prisma.bookExportJob.updateMany({
      where: { projectId: id, status: { in: ['preparing', 'generating'] } },
      data: { status: 'paused', token: null },
    });
    await Promise.all(jobs.map((j) => this.active.get(j.id)));
    await Promise.all(jobs.map((j) => this.cleaning.get(j.id)));
  }
  async resumeProject(id: string) {
    const jobs = await this.prisma.bookExportJob.findMany({
      where: { projectId: id, status: { in: ['paused', 'deleting', 'delete_failed'] } },
    });
    for (const j of jobs) {
      if (j.status !== 'paused') {
        this.startCleanup(id, j.id);
        continue;
      }
      await this.prisma.bookExportJob.update({
        where: { id: j.id },
        data: {
          token: null,
          status: j.snapshotId ? 'generating' : 'failed',
          error: j.snapshotId ? null : '快照准备中断，请重新发起',
        },
      });
      if (j.snapshotId) this.enqueue(j.id);
    }
  }
  async onModuleInit() {
    const jobs = await this.prisma.bookExportJob.findMany({ include: { project: true } });
    for (const j of jobs) {
      if (j.project.deletedAt) {
        await this.prisma.bookExportJob.updateMany({
          where: { id: j.id, status: { in: ['preparing', 'generating'] } },
          data: { status: 'paused', token: null },
        });
        continue;
      }
      if (['deleting', 'delete_failed'].includes(j.status)) {
        this.startCleanup(j.projectId, j.id);
        continue;
      }
      if (['preparing', 'generating', 'paused'].includes(j.status)) {
        await this.prisma.bookExportJob.update({
          where: { id: j.id },
          data: {
            token: null,
            status: j.snapshotId ? 'generating' : 'failed',
            error: j.snapshotId ? null : '服务重启中断快照准备，请重新发起',
          },
        });
        if (j.snapshotId) this.enqueue(j.id);
        else {
          try {
            await this.files.remove(j.projectId, j.id);
          } catch {
            /* 失败记录保留，作者可重试删除。 */
          }
        }
      }
    }
  }
  async onModuleDestroy() {
    this.stopping = true;
    await this.queue;
    await Promise.all(this.cleaning.values());
  }
}
