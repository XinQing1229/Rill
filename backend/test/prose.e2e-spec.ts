const jest = import.meta.jest;
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { ProseReviewOutputSchema, ProseRevisionOutputSchema } from '@rill/shared';
import configuration from '../src/config/configuration.js';
import { LlmService } from '../src/ai/llm.service.js';
import { UsageRecorder } from '../src/ai/observability/usage-recorder.js';
import { NovelModule } from '../src/novel/novel.module.js';
import { PrismaService } from '../src/novel/prisma.service.js';
import { ProseFilesService } from '../src/novel/prose/prose-files.service.js';
import { deleteCheckpointThread, createCheckpointer } from '../src/novel/pipeline/checkpointer.js';

const directory = mkdtempSync(join(tmpdir(), 'rill-prose-http-'));
copyFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../pipeline-test.db'),
  join(directory, 'test.db'),
);
process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`;
describe('正文 HTTP 与持久化图', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let id: string;
  let files: ProseFilesService;
  const complete = jest.fn(async () => ({
    content: '# 信件\n\n林澈在门外发现了一封信。',
    finishReason: 'stop',
  }));
  const completeStructured = jest.fn(async (schema) =>
    schema === ProseRevisionOutputSchema
      ? {
          outcome: 'revised',
          content: '# 信件\n\n林澈在门外发现了一封信，他将信藏进袖口。',
          explanation: '增加行动',
          suggestionResponses: [],
        }
      : schema === ProseReviewOutputSchema
        ? {
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
          }
        : {
            events: ['发现信件'],
            characterChanges: [],
            foreshadowing: ['信的来历'],
            continuity: '调查来源',
          },
  );
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), NovelModule],
    })
      .overrideProvider(LlmService)
      .useValue({ complete, completeStructured })
      .overrideProvider(UsageRecorder)
      .useValue({ get: () => ({ promptTokens: 2, completionTokens: 3 }) })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...configuration(),
          PROSE_OUTPUT_DIR: join(directory, 'output'),
          pipeline: { checkpointFile: join(directory, 'checkpoint.db') },
        }),
      )
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = module.get(PrismaService);
    files = module.get(ProseFilesService);
  });
  beforeEach(async () => {
    complete.mockClear();
    completeStructured.mockClear();
    const p = await prisma.project.create({
      data: {
        title: '正文 HTTP',
        genre: 'dushi',
        length: 'short',
        mode: 'auto',
        currentStage: 'prose',
        answers: JSON.stringify({ genre: 'dushi', length: 'short', tone: '温暖', pov: '第三人称' }),
      },
    });
    id = p.id;
    const plan = {
      mainline: '调查信件',
      turningPoints: ['发现旧案'],
      climax: '揭开真相',
      ending: '真相大白',
      characterArcs: [{ characterId: 'author-character', development: '学会调查' }],
      relationDevelopments: [],
      segments: [
        {
          id: 'act1',
          title: '调查',
          goal: '找到来源',
          events: '追踪线索',
          outcome: '发现真相',
          startChapter: 1,
          endChapter: 3,
        },
      ],
    };
    const chapters = [1, 2, 3].map((number) => ({
      number,
      segmentId: 'act1',
      title: `第${number}章`,
      goal: '调查',
      events: '发现线索',
      conflict: '证人沉默',
      turn: '发现信件',
      outcome: '继续调查',
      consequence: '调查下一封信',
      characterIds: ['author-character'],
    }));
    await prisma.outline.create({
      data: {
        projectId: id,
        targetChapters: 3,
        step: 'outline_review',
        revision: 1,
        planRevision: 1,
        planConfirmedRevision: 1,
        confirmedRevision: 1,
        planData: JSON.stringify(plan),
        batches: {
          create: {
            planRevision: 1,
            startChapter: 1,
            endChapter: 3,
            segmentId: 'act1',
            status: 'done',
            data: JSON.stringify({ chapters }),
          },
        },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it.each(['manual', 'auto'])('%s 模式逐章接受、checkpoint 恢复和修改前文复核', async (mode) => {
    await prisma.project.update({ where: { id }, data: { mode } });
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/generate`)
      .send({ wait: true })
      .expect((response) => {
        if (response.status !== 201) throw new Error(JSON.stringify(response.body));
      })
      .expect(201);
    let p = await request(app.getHttpServer()).get(`/api/novel/projects/${id}`).expect(200);
    expect(p.body.status).toBe('idle');
    expect(p.body.currentStage).toBe('prose');
    expect(complete).toHaveBeenCalledTimes(1);
    const saver = createCheckpointer(join(directory, 'checkpoint.db'));
    await deleteCheckpointThread(saver, id);
    for (let n = 1; n <= 3; n++) {
      const d = await request(app.getHttpServer())
        .get(`/api/novel/projects/${id}/prose`)
        .expect(200);
      const c = d.body.chapters[n - 1];
      expect(c.summary.accepted).toBe(false);
      await request(app.getHttpServer())
        .post(`/api/novel/projects/${id}/prose/chapters/${n}/confirm`)
        .send({
          expectedRevision: c.revision,
          expectedHash: c.observedHash,
          reviewId: c.report.id,
          summaryId: c.summary.id,
        })
        .expect(201);
    }
    p = await request(app.getHttpServer()).get(`/api/novel/projects/${id}`).expect(200);
    expect(p.body.status).toBe('done');
    expect(complete).toHaveBeenCalledTimes(3);
    // 全流程接受完成后，独立导出不改变创作状态及模型调用数量。
    const exportBase = `/api/novel/projects/${id}/book-export`;
    const config = await request(app.getHttpServer())
      .get(exportBase + '/settings')
      .expect(200);
    await request(app.getHttpServer())
      .patch(exportBase + '/settings')
      .send({
        ...config.body,
        title: 'HTTP 成书',
        expectedRevision: config.body.revision,
        chapterTitles: [1, 2, 3].map((chapterNumber) => ({
          chapterNumber,
          title: '信件',
          outlineRevision: 1,
        })),
      })
      .expect(200);
    const preview = await request(app.getHttpServer())
      .post(exportBase + '/preview')
      .send({})
      .expect(200);
    expect(preview.body.diagnostics).toEqual([]);
    const { randomUUID } = await import('node:crypto');
    const exported = await request(app.getHttpServer())
      .post(exportBase + '/jobs')
      .send({
        requestId: randomUUID(),
        previewToken: preview.body.previewToken,
        formats: ['txt', 'markdown', 'epub'],
      })
      .expect(202);
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await request(app.getHttpServer())
        .get(exportBase + '/jobs/' + exported.body.id)
        .expect(200);
      if (result.body.status === 'succeeded') break;
      if (result.body.status === 'failed') throw new Error(JSON.stringify(result.body));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    for (const format of ['txt', 'markdown', 'epub'])
      await request(app.getHttpServer())
        .get(exportBase + '/jobs/' + exported.body.id + '/files/' + format)
        .expect(200);
    expect(complete).toHaveBeenCalledTimes(3);
    writeFileSync(await files.path(id, 'chapters/001.md'), '# 改写\n\n林澈在门外发现了两封信。');
    const d = await request(app.getHttpServer()).get(`/api/novel/projects/${id}/prose`).expect(200);
    expect(d.body.chapters[1].reviewStatus).toBe('needs_review');
    expect(d.body.completed).toBe(false);
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/prose/chapters/1/override`)
      .send({ reason: ' ' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/prose/chapters/3/retry`)
      .send({})
      .expect(400);
    await request(app.getHttpServer()).delete(`/api/novel/projects/${id}`).expect(200);
    await request(app.getHttpServer()).get(`/api/novel/projects/${id}/prose`).expect(404);
    await request(app.getHttpServer()).post(`/api/novel/projects/${id}/restore`).expect(201);
    await request(app.getHttpServer()).delete(`/api/novel/projects/${id}`).expect(200);
    await request(app.getHttpServer()).delete(`/api/novel/projects/${id}/permanent`).expect(200);
  });
  it('永久删除失败保留重试记录，重试成功才清理元数据', async () => {
    const p = await prisma.project.create({
      data: {
        title: '删除恢复',
        genre: 'dushi',
        length: 'short',
        currentStage: 'prose',
        deletedAt: new Date(),
      },
    });
    const spy = jest.spyOn(files, 'purge').mockRejectedValueOnce(new Error('测试目录清理失败'));
    await request(app.getHttpServer()).delete(`/api/novel/projects/${p.id}/permanent`).expect(500);
    expect(
      (await prisma.proseDeletion.findUnique({ where: { projectId: p.id } }))?.error,
    ).toContain('测试目录清理失败');
    expect(await prisma.project.findUnique({ where: { id: p.id } })).not.toBeNull();
    await request(app.getHttpServer()).post(`/api/novel/projects/${p.id}/restore`).expect(409);
    spy.mockRestore();
    await request(app.getHttpServer()).delete(`/api/novel/projects/${p.id}/permanent`).expect(200);
    expect(await prisma.proseDeletion.findUnique({ where: { projectId: p.id } })).toBeNull();
  });
  it('永久删除进行中拒绝恢复和重复删除，失败后仍拒绝恢复但允许清理重试', async () => {
    await request(app.getHttpServer()).delete(`/api/novel/projects/${id}`).expect(200);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest.spyOn(files, 'purge').mockImplementationOnce(async () => {
      enter();
      await gate;
    });
    const deleting = request(app.getHttpServer())
      .delete(`/api/novel/projects/${id}/permanent`)
      .then((response) => response);
    await entered;
    try {
      await request(app.getHttpServer()).post(`/api/novel/projects/${id}/restore`).expect(409);
      await request(app.getHttpServer()).delete(`/api/novel/projects/${id}/permanent`).expect(409);
      await request(app.getHttpServer())
        .post(`/api/novel/projects/${id}/generate`)
        .send({ wait: true })
        .expect(404);
    } finally {
      release();
    }
    expect((await deleting).status).toBe(200);
    spy.mockRestore();
    expect(await prisma.project.findUnique({ where: { id } })).toBeNull();
  });
  it('重复接受首章不会重试失败的第二章或改变失败状态', async () => {
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/generate`)
      .send({ wait: true })
      .expect(201);
    const d = await request(app.getHttpServer()).get(`/api/novel/projects/${id}/prose`).expect(200);
    const c = d.body.chapters[0];
    const body = {
      expectedRevision: c.revision,
      expectedHash: c.observedHash,
      reviewId: c.report.id,
      summaryId: c.summary.id,
    };
    complete.mockRejectedValueOnce(new Error('第二章模拟失败'));
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/prose/chapters/1/confirm`)
      .send(body)
      .expect(500);
    const draftCalls = complete.mock.calls.length;
    const machineCalls = completeStructured.mock.calls.length;
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/prose/chapters/1/confirm`)
      .send(body)
      .expect(201);
    expect(complete).toHaveBeenCalledTimes(draftCalls);
    expect(completeStructured).toHaveBeenCalledTimes(machineCalls);
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).status).toBe('failed');
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/generate`)
      .send({ wait: true })
      .expect(201);
    expect(complete).toHaveBeenCalledTimes(draftCalls + 1);
  });
  it('缩减目标后跳过范围外旧章，保留原文且拒绝越界执行', async () => {
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/generate`)
      .send({ wait: true })
      .expect(201);
    const d = await request(app.getHttpServer()).get(`/api/novel/projects/${id}/prose`).expect(200);
    const c = d.body.chapters[0];
    await files.create(id, 'chapters/002.md', '# 保留旧章\n\n作者写好的内容。');
    await prisma.outline.update({ where: { projectId: id }, data: { targetChapters: 1 } });
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/prose/chapters/1/confirm`)
      .send({
        expectedRevision: c.revision,
        expectedHash: c.observedHash,
        reviewId: c.report.id,
        summaryId: c.summary.id,
      })
      .expect(201);
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).status).toBe('done');
    expect(complete).toHaveBeenCalledTimes(1);
    expect((await files.read(id, 2)).content).toContain('作者写好的内容');
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/prose/chapters/2/regenerate`)
      .send({})
      .expect(410);
  });
  it.each(['not-a-number', '0', '-1', '1.5', 'Infinity', '9007199254740992'])(
    'HTTP 拒绝非法章号 %s，模型与项目状态不变',
    async (number) => {
      for (const action of ['retry', 'regenerate', 'confirm', 'override'])
        await request(app.getHttpServer())
          .post(`/api/novel/projects/${id}/prose/chapters/${number}/${action}`)
          .send({})
          .expect(400);
      expect(complete).not.toHaveBeenCalled();
      expect(completeStructured).not.toHaveBeenCalled();
      expect((await prisma.project.findUniqueOrThrow({ where: { id } })).status).toBe('idle');
      expect(await prisma.proseBook.findUnique({ where: { projectId: id } })).toBeNull();
    },
  );
  it('候选稿被删除后详情仍可读取并可正常接受正文，文件恢复后提示消失', async () => {
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/generate`)
      .send({ wait: true })
      .expect(201);
    const path = 'candidates/historical.md';
    const oldContent = '# 历史候选';
    await files.create(id, path, oldContent);
    await prisma.proseOperation.create({
      data: {
        projectId: id,
        runId: 'historical',
        kind: 'candidate',
        chapterNumber: 1,
        baseHash: 'a'.repeat(64),
        resultHash: 'b'.repeat(64),
        dependencyFingerprint: 'c'.repeat(64),
        candidatePath: path,
        phase: 'committed',
      },
    });
    const candidate = { path: await files.path(id, path), content: oldContent };
    const content = candidate.content;
    rmSync(candidate.path);
    const d = await request(app.getHttpServer()).get(`/api/novel/projects/${id}/prose`).expect(200);
    const c = d.body.chapters[0];
    expect(c.report).not.toBeNull();
    expect(c.summary).not.toBeNull();
    expect(c.candidates[0].fileStatus).toBe('missing');
    expect(c.candidates[0].error).toContain('删除或移动');
    expect(c.content).toContain('林澈');
    writeFileSync(candidate.path, content);
    const restored = await request(app.getHttpServer())
      .get(`/api/novel/projects/${id}/prose`)
      .expect(200);
    expect(restored.body.chapters[0].candidates[0].fileStatus).toBe('valid');
    expect(restored.body.chapters[0].candidates[0].error).toBeNull();
    rmSync(candidate.path);
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/prose/chapters/1/confirm`)
      .send({
        expectedRevision: c.revision,
        expectedHash: c.observedHash,
        reviewId: c.report.id,
        summaryId: c.summary.id,
      })
      .expect(201);
  });
  it('按建议修改 HTTP：预览、重复请求、应用、重新审核与旧接口下线', async () => {
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/generate`)
      .send({ wait: true })
      .expect(201);
    const base = `/api/novel/projects/${id}/prose/chapters/1`;
    const detail = await request(app.getHttpServer())
      .get(`/api/novel/projects/${id}/prose`)
      .expect(200);
    const chapter = detail.body.chapters[0];
    const body = {
      requestId: 'revision-http',
      feedback: '增加藏信动作',
      expectedRevision: chapter.revision,
      expectedHash: chapter.observedHash,
    };
    const created = await request(app.getHttpServer())
      .post(base + '/revisions')
      .send(body)
      .expect(202);
    const duplicate = await request(app.getHttpServer())
      .post(base + '/revisions')
      .send(body)
      .expect(202);
    expect(duplicate.body.id).toBe(created.body.id);
    let result;
    for (let n = 0; n < 100; n++) {
      result = await request(app.getHttpServer())
        .get(base + '/revisions/' + created.body.id)
        .expect(200);
      if (result.body.status !== 'generating') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(result!.body.status).toBe('ready');
    expect((await files.read(id, 1)).hash).toBe(chapter.observedHash);
    await request(app.getHttpServer())
      .get(`/api/novel/projects/${id}/prose/chapters/2/revisions/${created.body.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(base + '/revisions/' + created.body.id + '/apply')
      .send({
        requestId: 'apply-http',
        expectedRevision: chapter.revision,
        expectedHash: chapter.observedHash,
      })
      .expect(202);
    for (let n = 0; n < 100; n++) {
      result = await request(app.getHttpServer())
        .get(base + '/revisions/' + created.body.id)
        .expect(200);
      if (result.body.status !== 'applying') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(result!.body.status).toBe('applied');
    const latest = await request(app.getHttpServer())
      .get(`/api/novel/projects/${id}/prose`)
      .expect(200);
    expect(latest.body.chapters[0].content).toContain('藏进袖口');
    expect(latest.body.chapters[0].summary.accepted).toBe(false);
    expect(latest.body.chapters[0].machineStep).toBe('human_accept');
    expect(latest.body.chapters[1].content).toBeNull();
    await request(app.getHttpServer())
      .post(base + '/regenerate')
      .send({})
      .expect(410);
    await request(app.getHttpServer())
      .post(base + '/revisions')
      .send({ ...body, requestId: 'empty-http', feedback: '' })
      .expect(400);
  });
});
