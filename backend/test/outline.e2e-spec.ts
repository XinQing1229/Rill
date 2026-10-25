const jest = import.meta.jest;
import { ProseReviewOutputSchema, ProseSummaryGenerationSchema } from '@rill/shared';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import configuration from '../src/config/configuration.js';
import { NovelModule } from '../src/novel/novel.module.js';
import { LlmService } from '../src/ai/llm.service.js';
import { PrismaService } from '../src/novel/prisma.service.js';

const directory = mkdtempSync(join(tmpdir(), 'rill-outline-http-'));
copyFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../pipeline-test.db'),
  join(directory, 'test.db'),
);
process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`;

describe('大纲 HTTP 契约', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let id: string;
  let cid: string;
  const complete = jest.fn(async () => ({
    content: '# 调查\n\n主角发现了一封信。',
    finishReason: 'stop',
  }));
  const completeStructured = jest.fn();
  const base = () => `/api/novel/projects/${id}/outline`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), NovelModule],
    })
      .overrideProvider(LlmService)
      .useValue({ complete, completeStructured })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          ...configuration(),
          PROSE_OUTPUT_DIR: join(directory, 'output'),
          pipeline: { checkpointFile: join(directory, 'cp.db') },
        }),
      )
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = module.get(PrismaService);
    const project = await prisma.project.create({
      data: {
        title: 'HTTP',
        genre: 'dushi',
        length: 'short',
        currentStage: 'outline',
        answers: JSON.stringify({ genre: 'dushi', length: 'short', tone: '温暖', pov: '第三人称' }),
      },
    });
    id = project.id;
    await prisma.premise.create({ data: { projectId: id, status: 'done', data: '{}' } });
    const character = await prisma.character.create({
      data: { projectId: id, name: '甲', role: 'protagonist', status: 'done', data: '{}' },
    });
    cid = character.id;
    await prisma.stageRun.createMany({
      data: ['premise', 'characters', 'relations'].map((stage) => ({
        projectId: id,
        stage,
        runId: 'seed',
        status: 'done',
        confirmedAt: new Date(),
      })),
    });
    completeStructured.mockImplementation(async (schema, messages) => {
      const prompt = messages[0].content as string;
      if (schema === ProseReviewOutputSchema)
        return schema.parse({
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
        });
      if (schema === ProseSummaryGenerationSchema)
        return schema.parse({
          events: ['主角发现信件'],
          characterChanges: [],
          foreshadowing: [],
          continuity: '继续调查',
        });
      if (prompt.includes('当前批次：')) {
        const batch = JSON.parse(prompt.split('当前批次：')[1]);
        return schema.parse({
          chapters: Array.from(
            { length: batch.endChapter - batch.startChapter + 1 },
            (_, index) => ({
              number: batch.startChapter + index,
              segmentId: 'act',
              title: '调查',
              events: '调查事件',
              characterIds: [cid],
              conflict: '隐瞒',
              outcome: '真相',
              consequence: '继续',
            }),
          ),
        });
      }
      return schema.parse({
        mainline: '主线',
        turningPoints: ['转折'],
        climax: '高潮',
        ending: '结局',
        characterArcs: [{ characterId: cid, development: '成长' }],
        relationDevelopments: [],
        segments: [
          {
            id: 'act',
            title: '开篇',
            goal: '寻找',
            events: '调查',
            outcome: '真相',
            startChapter: 1,
            endChapter: 3,
          },
        ],
      });
    });
  });
  afterAll(async () => {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('读取不创建记录；校验错误和旧版本冲突', async () => {
    await request(app.getHttpServer())
      .get(base())
      .expect(200)
      .expect((res) => expect(res.body.targetChapters).toBe(4));
    expect(await prisma.outline.findUnique({ where: { projectId: id } })).toBeNull();
    await request(app.getHttpServer())
      .patch(`${base()}/config`)
      .send({ expectedRevision: 0, targetChapters: 0 })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${base()}/config`)
      .send({ expectedRevision: 0, targetChapters: 3 })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${base()}/config`)
      .send({ expectedRevision: 0, targetChapters: 4 })
      .expect(409);
  });
  it('生成、编辑规划、两步确认和单章保存', async () => {
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/generate`)
      .send({ wait: true })
      .expect(201);
    let detail = (await request(app.getHttpServer()).get(base()).expect(200)).body;
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/confirm`)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${base()}/plan`)
      .send({ expectedRevision: detail.revision, plan: { ...detail.plan, ending: '人工结局' } })
      .expect(200);
    detail = (await request(app.getHttpServer()).get(base())).body;
    expect(detail.chapters).toHaveLength(0);
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/confirm`)
      .send({ target: 'outline-plan', expectedRevision: detail.revision })
      .expect(201);
    detail = (await request(app.getHttpServer()).get(base())).body;
    expect(detail.step).toBe('outline_review');
    expect(detail.chapters).toHaveLength(3);
    await request(app.getHttpServer())
      .patch(`${base()}/chapters/1`)
      .send({
        expectedRevision: detail.revision,
        chapter: { ...detail.chapters[0], events: '人工事件' },
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${base()}/chapters/1`)
      .send({ expectedRevision: detail.revision, chapter: detail.chapters[0] })
      .expect(409);
    detail = (await request(app.getHttpServer()).get(base())).body;
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/confirm`)
      .send({ target: 'outline', expectedRevision: detail.revision })
      .expect(201); // 确认大纲后直接生成正文，逐章等待接受。
    detail = (await request(app.getHttpServer()).get(base())).body;
    expect(detail.step).toBe('confirmed');
    expect(detail.chapters[0].events).toBe('人工事件');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await prisma.beatBook.count({ where: { projectId: id } })).toBe(0);
    expect(
      (await request(app.getHttpServer()).get(`/api/novel/projects/${id}`)).body.currentStage,
    ).toBe('prose');
    await request(app.getHttpServer()).get(`/api/novel/projects/${id}/beats`).expect(404);
    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/rollback`)
      .send({ stage: 'beats' })
      .expect(400);
  });
});
