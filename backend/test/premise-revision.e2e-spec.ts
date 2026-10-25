const jest = import.meta.jest;
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import configuration from '../src/config/configuration.js';
import { NovelModule } from '../src/novel/novel.module.js';
import { LlmService } from '../src/ai/llm.service.js';
import { PrismaService } from '../src/novel/prisma.service.js';
import { ArtifactRegistry } from '../src/novel/pipeline/artifact.registry.js';
import { premiseFixture as sample } from './fixtures/premise.js';

const directory = mkdtempSync(join(tmpdir(), 'rill-premise-http-'));
copyFileSync(new URL('../pipeline-test.db', import.meta.url), join(directory, 'test.db'));
process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`;
let app: INestApplication;
let prisma: PrismaService;
let artifacts: ArtifactRegistry;
let id: string;
const completeStructured = jest.fn();
const base = () => `/api/novel/projects/${id}`;
const body = () => ({ requestId: randomUUID(), feedback: '加强冲突' });

beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), NovelModule],
  })
    .overrideProvider(LlmService)
    .useValue({ completeStructured })
    .overrideProvider(ConfigService)
    .useValue(
      new ConfigService({
        ...configuration(),
        pipeline: { checkpointFile: join(directory, 'cp.db') },
      }),
    )
    .compile();
  app = module.createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api');
  await app.init();
  prisma = module.get(PrismaService);
  artifacts = module.get(ArtifactRegistry);
});
afterAll(async () => {
  await app?.close();
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  completeStructured.mockReset();
  completeStructured.mockResolvedValue({
    premise: { ...sample, coreConflict: '新冲突' },
    changeNotes: [{ path: 'coreConflict', description: '加强核心矛盾' }],
  });
  const project = await prisma.project.create({
    data: {
      title: '旧城来信',
      genre: 'dushi',
      length: 'short',
      currentStage: 'outline',
      answers: JSON.stringify({ genre: 'dushi', length: 'short', tone: '温暖', pov: '第三人称' }),
      premise: { create: { data: JSON.stringify(sample), status: 'done' } },
    },
  });
  id = project.id;
});

it('HTTP 契约拒绝空建议、非法身份与无效采用', async () => {
  await request(app.getHttpServer())
    .post(`${base()}/premise/preview`)
    .send({ ...body(), feedback: '  ' })
    .expect(400);
  await request(app.getHttpServer())
    .post(`${base()}/premise/preview`)
    .send({ ...body(), requestId: 'bad' })
    .expect(400);
  await request(app.getHttpServer()).post(`${base()}/premise/adopt`).send({}).expect(400);
  await request(app.getHttpServer())
    .post(`${base()}/premise/adopt`)
    .send({ candidateId: 'missing' })
    .expect(404);
  expect(completeStructured).not.toHaveBeenCalled();
});

it('后续阶段生成预览不改变进度，重复请求复用候选', async () => {
  const input = body();
  const first = (
    await request(app.getHttpServer()).post(`${base()}/premise/preview`).send(input).expect(201)
  ).body;
  const again = (
    await request(app.getHttpServer()).post(`${base()}/premise/preview`).send(input).expect(201)
  ).body;
  expect(first.changeSummary.changes).toMatchObject([
    {
      path: 'coreConflict',
      before: sample.coreConflict,
      after: '新冲突',
      description: '加强核心矛盾',
      descriptionSource: 'ai',
    },
  ]);
  expect(again).toEqual(first);
  expect(completeStructured).toHaveBeenCalledTimes(1);
  expect(await prisma.project.findUnique({ where: { id } })).toMatchObject({
    currentStage: 'outline',
    status: 'idle',
  });
  expect(
    JSON.parse((await prisma.premise.findUniqueOrThrow({ where: { projectId: id } })).data),
  ).toEqual(sample);
});

it('项目运行时修改被拒绝，预览运行期间其他入口被拒绝', async () => {
  const input = body();
  let finish!: (data: unknown) => void;
  completeStructured.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = request(app.getHttpServer())
    .post(`${base()}/premise/preview`)
    .send(input)
    .then((response) => response);
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 2));
  try {
    await request(app.getHttpServer()).post(`${base()}/premise/preview`).send(body()).expect(409);
    await request(app.getHttpServer())
      .post(`${base()}/premise/adopt`)
      .send({ candidateId: 'c' })
      .expect(409);
    await request(app.getHttpServer()).post(`${base()}/generate`).send({}).expect(409);
    await request(app.getHttpServer())
      .post(`${base()}/rollback`)
      .send({ stage: 'premise' })
      .expect(409);
    await request(app.getHttpServer()).delete(base()).expect(409);
  } finally {
    finish({ premise: sample, changeNotes: [] });
  }
  expect((await pending).status).toBe(201);
});

it.each(['manual', 'auto'])('%s 模式采用后待确认，确认从新种子的下一阶段继续', async (mode) => {
  await prisma.project.update({ where: { id }, data: { mode } });
  await prisma.stageRun.create({
    data: {
      projectId: id,
      stage: 'premise',
      runId: 'old',
      status: 'done',
      confirmedAt: new Date(),
    },
  });
  // 模型阶段生成替身仍由真实图编排，以验证起点与 auto/manual 行为。
  const seen: string[] = [];
  for (const stage of ['characters', 'relations', 'outline'] as const) {
    artifacts.registerGenerator({
      stage,
      requires: () => ['premise'],
      generate: async (context) => {
        seen.push(stage);
        expect(context.premise?.coreConflict).toBe('新冲突');
        if (mode === 'auto' && stage === 'relations') throw new Error('测试暂停自动推进');
        if (stage === 'outline') throw new Error('测试停止在后续阶段');
      },
    });
  }
  const candidate = (
    await request(app.getHttpServer()).post(`${base()}/premise/preview`).send(body()).expect(201)
  ).body;
  const adopted = (
    await request(app.getHttpServer())
      .post(`${base()}/premise/adopt`)
      .send({ candidateId: candidate.candidateId })
      .expect(201)
  ).body;
  expect(adopted).toMatchObject({ currentStage: 'premise', status: 'idle', mode });
  expect(adopted.stageStates.premise).toMatchObject({
    status: 'done',
    stale: false,
    confirmedAt: null,
  });
  expect(seen).toEqual([]);
  expect(completeStructured).toHaveBeenCalledTimes(1);
  await request(app.getHttpServer())
    .post(`${base()}/confirm`)
    .send({})
    .expect(mode === 'auto' ? 500 : 201);
  expect(seen[0]).toBe('characters');
  expect(completeStructured).toHaveBeenCalledTimes(1);
  expect((await prisma.project.findUniqueOrThrow({ where: { id } })).currentStage).not.toBe(
    'premise',
  );
});

it('采用撤销下游确认、保留内容，跨项目和回收站请求不可达', async () => {
  await prisma.character.create({
    data: {
      projectId: id,
      name: '配角',
      role: 'supporting',
      data: '{"保留":"人物"}',
      status: 'done',
    },
  });
  await prisma.stageRun.createMany({
    data: ['premise', 'characters', 'relations', 'outline', 'prose'].map((stage) => ({
      projectId: id,
      stage,
      runId: 'initial',
      status: 'done',
      confirmedAt: new Date(),
    })),
  });
  const candidate = (
    await request(app.getHttpServer()).post(`${base()}/premise/preview`).send(body()).expect(201)
  ).body;
  const other = await prisma.project.create({
    data: { title: '其他', genre: 'dushi', length: 'short', currentStage: 'premise' },
  });
  await request(app.getHttpServer())
    .post(`/api/novel/projects/${other.id}/premise/adopt`)
    .send({ candidateId: candidate.candidateId })
    .expect(404);
  await request(app.getHttpServer())
    .post(`${base()}/premise/adopt`)
    .send({ candidateId: candidate.candidateId })
    .expect(201);
  expect(await prisma.character.findFirst({ where: { projectId: id } })).toMatchObject({
    stale: true,
    data: '{"保留":"人物"}',
  });
  const downstream = await prisma.stageRun.findMany({
    where: { projectId: id, stage: { not: 'premise' } },
  });
  expect(downstream.every((entry) => entry.stale && entry.confirmedAt === null)).toBe(true);
  await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
  await request(app.getHttpServer()).post(`${base()}/premise/preview`).send(body()).expect(404);
  await request(app.getHttpServer())
    .post(`${base()}/premise/adopt`)
    .send({ candidateId: candidate.candidateId })
    .expect(404);
});

it.each(['author', 'generated'])('%s 书名在预览时保持，采用时按来源同步', async (titleSource) => {
  await prisma.project.update({ where: { id }, data: { titleSource } });
  completeStructured.mockResolvedValue({
    premise: { ...sample, title: '新的暂定书名' },
    changeNotes: [{ path: 'title', description: '调整暂定书名' }],
  });
  const preview = await request(app.getHttpServer())
    .post(`${base()}/premise/preview`)
    .send(body())
    .expect(201);
  const expected = titleSource === 'author' ? '旧城来信' : '新的暂定书名';
  expect(preview.body.premise.title).toBe(expected);
  expect((await prisma.project.findUniqueOrThrow({ where: { id } })).title).toBe('旧城来信');
  await request(app.getHttpServer())
    .post(`${base()}/premise/adopt`)
    .send({ candidateId: preview.body.candidateId })
    .expect(201);
  const project = await prisma.project.findUniqueOrThrow({
    where: { id },
    include: { premise: true },
  });
  expect(project.title).toBe(expected);
  expect(JSON.parse(project.premise!.data).title).toBe(expected);
});
