import sharp from 'sharp';
import { CoverService } from '../src/novel/cover/cover.service.js';
const jest = import.meta.jest;
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { unzipSync, strFromU8 } from 'fflate';
import { BookExportModule } from '../src/novel/book-export/book-export.module.js';
import { BookExportService } from '../src/novel/book-export/book-export.service.js';
import { BookExportFilesService } from '../src/novel/book-export/book-export-files.service.js';
import { PrismaService } from '../src/novel/prisma.service.js';
import { ProseFilesService, proseHash } from '../src/novel/prose/prose-files.service.js';
import { proseDependencyFingerprint } from '../src/novel/prose/prose-fingerprint.js';
import { type BookJob, type BookPreview } from '@rill/shared';

const directory = mkdtempSync(join(tmpdir(), 'rill-book-http-'));
copyFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../pipeline-test.db'),
  join(directory, 'test.db'),
);
process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`;
describe('书本交付 HTTP、快照与任务恢复', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: BookExportService;
  let files: ProseFilesService;
  let exportFiles: BookExportFilesService;
  let id: string;
  const base = () => `/api/novel/projects/${id}/book-export`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), BookExportModule],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ PROSE_OUTPUT_DIR: join(directory, 'output') }))
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = module.get(PrismaService);
    service = module.get(BookExportService);
    files = module.get(ProseFilesService);
    exportFiles = module.get(BookExportFilesService);
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    const project = await prisma.project.create({
      data: {
        title: '项目名',
        genre: 'dushi',
        length: 'short',
        currentStage: 'prose',
        status: 'done',
      },
    });
    id = project.id;
    const chapters = [1, 2].map((number) => ({
      number,
      segmentId: 'act1',
      title: '信',
      events: '收到信',
      characterIds: ['hero'],
      conflict: '失踪',
      outcome: '发现线索',
      consequence: '继续调查',
    }));
    await prisma.outline.create({
      data: {
        projectId: id,
        targetChapters: 2,
        revision: 1,
        planRevision: 1,
        confirmedRevision: 1,
        batches: {
          create: {
            planRevision: 1,
            startChapter: 1,
            endChapter: 2,
            segmentId: 'act1',
            status: 'done',
            data: JSON.stringify({ chapters }),
          },
        },
      },
    });
    const book = await prisma.proseBook.create({
      data: { projectId: id, targetChapters: 2, completedRevision: 0 },
    });
    const previous: Array<{ chapterNumber: number; hash: string; data: unknown }> = [];
    for (const n of [1, 2]) {
      const source = `# 信\n\n第 ${n} 封 **旧信**。\n\n第二段。`;
      const hash = proseHash(source);
      // 使用历史正文记录的版本盐，验证无节拍产物时原有接受证据仍有效。
      const fp = proseDependencyFingerprint(1, 7, previous);
      const chapter = await prisma.proseChapter.create({
        data: {
          bookId: book.id,
          chapterNumber: n,
          relativePath: files.chapterPath(n),
          observedHash: hash,
          confirmedHash: hash,
          fileStatus: 'valid',
          reviewStatus: 'confirmed',
          generationStatus: 'done',
          outlineRevision: 1,
          beatChapterRevision: 7,
          prefixFingerprint: fp,
        },
      });
      const review = await prisma.proseReview.create({
        data: {
          chapterId: chapter.id,
          sourceHash: hash,
          dependencyFingerprint: fp,
          promptVersion: 'v1',
          status: 'done',
          verdict: 'accept',
          data: JSON.stringify({
            scores: {
              consistency: 90,
              character: 90,
              pacing: 90,
              continuity: 90,
              foreshadow: 90,
              hook: 90,
              aesthetic: 90,
            },
            issues: [],
            coveredChapters: Array.from({ length: n - 1 }, (_, i) => i + 1),
          }),
        },
      });
      const data = {
        events: ['收到信'],
        characterChanges: [],
        foreshadowing: [],
        continuity: '继续调查',
      };
      const summary = await prisma.proseSummary.create({
        data: {
          chapterId: chapter.id,
          sourceHash: hash,
          prefixFingerprint: fp,
          reviewId: review.id,
          data: JSON.stringify(data),
          status: 'done',
          acceptedAt: new Date(),
        },
      });
      await prisma.proseAcceptance.create({
        data: {
          chapterId: chapter.id,
          reviewId: review.id,
          summaryId: summary.id,
          sourceHash: hash,
          dependencyFingerprint: fp,
        },
      });
      await files.create(id, files.chapterPath(n), source);
      previous.push({ chapterNumber: n, hash, data });
    }
    await service.saveSettings(id, {
      title: '雪 & 信',
      author: '',
      introduction: '旧简介',
      chapterTitles: [],
      expectedRevision: 0,
    });
  });
  afterAll(async () => {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function preview() {
    return (
      await request(app.getHttpServer())
        .post(base() + '/preview')
        .send({})
        .expect(200)
    ).body as BookPreview;
  }
  async function create(formats = ['txt', 'markdown', 'epub']) {
    const p = await preview();
    expect(p.diagnostics).toEqual([]);
    const r = await request(app.getHttpServer())
      .post(base() + '/jobs')
      .send({ requestId: randomUUID(), previewToken: p.previewToken, formats })
      .expect(202);
    return r.body as BookJob;
  }
  async function settled(jobId: string) {
    for (let n = 0; n < 200; n++) {
      const j = await service.job(id, jobId);
      if (!['preparing', 'generating', 'deleting'].includes(j.status)) return j;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('导出任务未结束');
  }
  it('配置 CAS、相同保存、逐章三种复制与未接受阻塞', async () => {
    const s = await service.settings(id);
    const same = await service.saveSettings(id, { ...s, expectedRevision: s.revision });
    expect(same.revision).toBe(s.revision);
    await request(app.getHttpServer())
      .patch(base() + '/settings')
      .send({ ...s, expectedRevision: 0 })
      .expect(409);
    await prisma.proseChapter.updateMany({
      where: { book: { projectId: id }, chapterNumber: 2 },
      data: { reviewStatus: 'pending' },
    });
    const copy = await request(app.getHttpServer())
      .post(base() + '/chapters/1/copy')
      .send({ mode: 'plain-with-title' })
      .expect(200);
    expect(copy.body.text).toContain('第 1 章 信');
    expect(copy.body.text).not.toContain('**');
    const raw = await service.copy(id, 1, 'markdown-source');
    expect(raw.text).toContain('# 信');
    expect(raw.text).toContain('**旧信**');
    expect((await service.copy(id, 1, 'plain-body')).text).not.toContain('第 1 章 信');
    await request(app.getHttpServer())
      .post(base() + '/chapters/2/copy')
      .send({ mode: 'plain-body' })
      .expect(422);
    expect((await preview()).previewToken).toBeNull();
    await request(app.getHttpServer())
      .post(base() + '/chapters/0/copy')
      .send({ mode: 'plain-body' })
      .expect(400);
  });
  it('预填不写配置，上游变化不覆盖已保存信息，章名覆盖待核对', async () => {
    await prisma.bookExportSettings.delete({ where: { projectId: id } });
    await prisma.premise.create({
      data: {
        projectId: id,
        status: 'done',
        data: JSON.stringify({ title: '种子暂定名', logline: '一句话简介' }),
      },
    });
    const initial = await service.settings(id);
    expect(initial).toMatchObject({
      title: '种子暂定名',
      author: '',
      introduction: '一句话简介',
      revision: 0,
    });
    expect(await prisma.bookExportSettings.findUnique({ where: { projectId: id } })).toBeNull();
    await service.saveSettings(id, {
      ...initial,
      title: '作者决定名',
      chapterTitles: [{ chapterNumber: 1, title: '来信', outlineRevision: 1 }],
      expectedRevision: 0,
    });
    await prisma.premise.update({
      where: { projectId: id },
      data: { data: JSON.stringify({ title: '另一个种子名', logline: '另一个简介' }) },
    });
    await prisma.outline.update({ where: { projectId: id }, data: { revision: 2 } });
    const changed = await service.settings(id);
    expect(changed.title).toBe('作者决定名');
    expect(changed.chapters[0].needsCheck).toBe(true);
    expect(await prisma.proseChapter.findMany({ where: { book: { projectId: id } } })).toEqual(
      expect.arrayContaining([expect.objectContaining({ reviewStatus: 'confirmed' })]),
    );
  });
  it('审核覆盖不全或摘要损坏时拒绝交付', async () => {
    const chapter = await prisma.proseChapter.findFirstOrThrow({
      where: { book: { projectId: id }, chapterNumber: 2 },
      include: { reviews: true, summaries: true },
    });
    const stored = JSON.parse(chapter.reviews[0].data!) as Record<string, unknown>;
    await prisma.proseReview.update({
      where: { id: chapter.reviews[0].id },
      data: { data: JSON.stringify({ ...stored, coveredChapters: [] }) },
    });
    await request(app.getHttpServer())
      .post(base() + '/chapters/2/copy')
      .send({ mode: 'plain-body' })
      .expect(422);
    await prisma.proseReview.update({
      where: { id: chapter.reviews[0].id },
      data: { data: JSON.stringify(stored) },
    });
    await prisma.proseSummary.update({
      where: { id: chapter.summaries[0].id },
      data: { data: 'broken' },
    });
    await request(app.getHttpServer())
      .post(base() + '/chapters/2/copy')
      .send({ mode: 'markdown-source' })
      .expect(422);
  });
  it('三格式同快照，更新后历史下载不变且 EPUB 可解包', async () => {
    const j = await create();
    expect((await settled(j.id)).status).toBe('succeeded');
    const txt = await service.download(id, j.id, 'txt');
    expect(txt.data.toString()).toContain('第 2 封 旧信。');
    if (process.env.RILL_EXPORT_QA_DIR) {
      const qa = process.env.RILL_EXPORT_QA_DIR;
      mkdirSync(qa, { recursive: true });
      copyFileSync(join(directory, 'test.db'), join(qa, 'qa.db'));
      cpSync(join(directory, 'output'), join(qa, 'output'), { recursive: true });
      writeFileSync(join(qa, 'fixture.json'), JSON.stringify({ projectId: id, jobId: j.id }));
    }
    const epub = await service.download(id, j.id, 'epub');
    const zip = unzipSync(epub.data);
    expect(strFromU8(zip['OEBPS/content.opf'])).toContain('雪 &amp; 信');
    const response = await request(app.getHttpServer())
      .get(base() + `/jobs/${j.id}/files/txt`)
      .expect(200);
    expect(response.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(response.text).toBe(txt.data.toString());
    const s = await service.settings(id);
    await service.saveSettings(id, { ...s, title: '新书名', expectedRevision: s.revision });
    writeFileSync(await files.path(id, files.chapterPath(1)), '# 信\n\n修改后正文');
    expect((await service.job(id, j.id)).versionStatus).toBe('historical');
    expect((await service.download(id, j.id, 'txt')).data.equals(txt.data)).toBe(true);
    await request(app.getHttpServer())
      .post(base() + '/chapters/2/copy')
      .send({ mode: 'plain-body' })
      .expect(422);
    expect(await prisma.project.findUnique({ where: { id } })).toMatchObject({ status: 'done' });
  });
  it('过期预览、幂等请求及同标识不同参数', async () => {
    const p = await preview();
    const requestId = randomUUID();
    const body = { requestId, previewToken: p.previewToken, formats: ['txt'] };
    const a = await request(app.getHttpServer())
      .post(base() + '/jobs')
      .send(body)
      .expect(202);
    const b = await request(app.getHttpServer())
      .post(base() + '/jobs')
      .send(body)
      .expect(202);
    expect(a.body.id).toBe(b.body.id);
    await request(app.getHttpServer())
      .post(base() + '/jobs')
      .send({ ...body, formats: ['epub'] })
      .expect(409);
    await settled(a.body.id);
    const s = await service.settings(id);
    await service.saveSettings(id, { ...s, title: '已修改', expectedRevision: s.revision });
    await request(app.getHttpServer())
      .post(base() + '/jobs')
      .send({ ...body, requestId: randomUUID() })
      .expect(409);
    await request(app.getHttpServer())
      .post(base() + '/jobs')
      .send({ ...body, requestId: randomUUID(), formats: ['txt', 'txt'] })
      .expect(400);
  });
  it('单格式失败可独立重试，文件丢失恢复不读取新正文', async () => {
    const write = exportFiles.write.bind(exportFiles);
    let fail = true;
    jest.spyOn(exportFiles, 'write').mockImplementation(async (...args) => {
      if (args[2] === 'files/book.epub' && fail) {
        fail = false;
        throw new Error('测试 EPUB 写入失败');
      }
      return write(...args);
    });
    const j = await create();
    const partial = await settled(j.id);
    expect(partial.status).toBe('partial_failed');
    const snapshot = partial.snapshotId;
    await service.retry(id, j.id, ['epub']);
    expect((await settled(j.id)).snapshotId).toBe(snapshot);
    const before = await service.download(id, j.id, 'txt');
    rmSync(await exportFiles.path(id, j.id, 'files/book.txt'));
    await request(app.getHttpServer())
      .get(base() + `/jobs/${j.id}/files/txt`)
      .expect(404);
    writeFileSync(await files.path(id, files.chapterPath(1)), '全新正文');
    await service.retry(id, j.id, ['txt']);
    await settled(j.id);
    expect((await service.download(id, j.id, 'txt')).data.equals(before.data)).toBe(true);
    expect(
      (
        await prisma.bookExportFile.findUniqueOrThrow({
          where: { jobId_format: { jobId: j.id, format: 'markdown' } },
        })
      ).attempts,
    ).toBe(1);
  });
  it('快照准备竞争拒绝提交，源文件不被覆盖', async () => {
    const snapshot = exportFiles.snapshot.bind(exportFiles);
    jest.spyOn(exportFiles, 'snapshot').mockImplementation(async (...args) => {
      const r = await snapshot(...args);
      await prisma.proseChapter.updateMany({
        where: { book: { projectId: id } },
        data: { stale: true },
      });
      return r;
    });
    const j = await create(['txt']);
    expect((await settled(j.id)).status).toBe('failed');
    expect(
      (await prisma.bookExportJob.findUniqueOrThrow({ where: { id: j.id } })).snapshotId,
    ).toBeNull();
    expect(readFileSync(await files.path(id, files.chapterPath(1)), 'utf8')).toContain('旧信');
  });
  it('快照损坏、跨项目、删除及清理失败重试', async () => {
    const j = await create(['txt']);
    await settled(j.id);
    const other = await prisma.project.create({
      data: { title: '其他项目', genre: 'dushi', length: 'short', currentStage: 'prose' },
    });
    await request(app.getHttpServer())
      .get(`/api/novel/projects/${other.id}/book-export/jobs/${j.id}`)
      .expect(404);
    const spy = jest.spyOn(exportFiles, 'remove').mockRejectedValueOnce(new Error('清理失败'));
    await service.remove(id, j.id);
    for (let n = 0; n < 100; n++) {
      if ((await service.job(id, j.id)).status === 'delete_failed') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await service.job(id, j.id)).status).toBe('delete_failed');
    spy.mockRestore();
    await service.remove(id, j.id);
    for (let n = 0; n < 100; n++) {
      if (!(await prisma.bookExportJob.findUnique({ where: { id: j.id } }))) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(existsSync(await exportFiles.path(id, j.id))).toBe(false);
    expect(await prisma.bookExportJob.findUnique({ where: { id: j.id } })).toBeNull();
    const second = await create(['txt']);
    await settled(second.id);
    writeFileSync(await exportFiles.path(id, second.id, 'snapshot/manifest.json'), 'broken');
    await prisma.bookExportFile.updateMany({
      where: { jobId: second.id },
      data: { status: 'failed' },
    });
    await expect(service.retry(id, second.id, ['txt'])).rejects.toThrow('快照清单损坏');
  });
  it('删除执行中的任务撤销写入，不产生迟到文件', async () => {
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((r) => {
      started = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const write = exportFiles.write.bind(exportFiles);
    jest.spyOn(exportFiles, 'write').mockImplementation(async (...args) => {
      if (args[2] === 'files/book.txt') {
        started();
        await gate;
      }
      return write(...args);
    });
    const j = await create(['txt']);
    await entered;
    await service.remove(id, j.id);
    release();
    for (let n = 0; n < 100; n++) {
      if (!(await prisma.bookExportJob.findUnique({ where: { id: j.id } }))) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(await prisma.bookExportJob.findUnique({ where: { id: j.id } })).toBeNull();
    expect(existsSync(await exportFiles.path(id, j.id))).toBe(false);
  });
  it('文件发布后状态提交失败不交付半成功结果', async () => {
    const write = exportFiles.write.bind(exportFiles);
    let fail = true;
    jest.spyOn(exportFiles, 'write').mockImplementation(async (...args) => {
      if (args[2] === 'files/txt.receipt.json' && fail) {
        fail = false;
        throw new Error('测试文件发布后中断');
      }
      return write(...args);
    });
    const j = await create(['txt']);
    expect((await settled(j.id)).status).toBe('failed');
    await request(app.getHttpServer())
      .get(base() + `/jobs/${j.id}/files/txt`)
      .expect(404);
    await service.retry(id, j.id, ['txt']);
    expect((await settled(j.id)).status).toBe('succeeded');
  });
  it('恢复完整快照、准备中断失败、软删除冻结与恢复', async () => {
    const j = await create(['txt']);
    await settled(j.id);
    await prisma.bookExportJob.update({
      where: { id: j.id },
      data: { status: 'generating', token: 'old-worker' },
    });
    await prisma.bookExportFile.updateMany({
      where: { jobId: j.id },
      data: { status: 'generating' },
    });
    await service.onModuleInit();
    expect((await settled(j.id)).status).toBe('succeeded');
    const interrupted = await prisma.bookExportJob.create({
      data: {
        projectId: id,
        requestId: randomUUID(),
        requestHash: 'a',
        previewToken: 'b',
        formats: '["txt"]',
      },
    });
    await service.onModuleInit();
    expect((await service.job(id, interrupted.id)).status).toBe('failed');
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    await service.pauseProject(id);
    await request(app.getHttpServer())
      .get(base() + `/jobs/${j.id}/files/txt`)
      .expect(404);
    await prisma.project.update({ where: { id }, data: { deletedAt: null } });
    await service.resumeProject(id);
    expect((await service.download(id, j.id, 'txt')).data.length).toBeGreaterThan(0);
  });
  it('封面快照随任务固定，换图与删除不影响历史 EPUB，旧预览失效', async () => {
    const covers = app.get(CoverService);
    const image = await sharp({
      create: { width: 30, height: 40, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const first = await covers.upload(id, image, 'first.png', 0);
    const before = await preview();
    const job = await create(['epub']);
    expect((await settled(job.id)).status).toBe('succeeded');
    const file = await service.download(id, job.id, 'epub');
    const zip = unzipSync(file.data);
    expect(zip['OEBPS/cover.png']).toBeDefined();
    expect(strFromU8(zip['OEBPS/content.opf'])).toContain('properties="cover-image"');
    expect(strFromU8(zip['OEBPS/content.opf']).indexOf('idref="cover-page"')).toBeLessThan(
      strFromU8(zip['OEBPS/content.opf']).indexOf('idref="title"'),
    );
    await covers.remove(id, first.currentCover!.id, first.revision);
    await request(app.getHttpServer())
      .post(base() + '/jobs')
      .send({ requestId: randomUUID(), previewToken: before.previewToken, formats: ['epub'] })
      .expect(409);
    expect((await service.job(id, job.id)).versionStatus).toBe('historical');
    const original = Buffer.from(zip['OEBPS/cover.png']);
    await prisma.bookExportFile.updateMany({
      where: { jobId: job.id },
      data: { status: 'failed' },
    });
    await prisma.bookExportJob.update({ where: { id: job.id }, data: { status: 'failed' } });
    await service.retry(id, job.id, ['epub']);
    expect((await settled(job.id)).status).toBe('succeeded');
    expect(
      Buffer.from(unzipSync((await service.download(id, job.id, 'epub')).data)['OEBPS/cover.png']),
    ).toEqual(original);
  });
});
