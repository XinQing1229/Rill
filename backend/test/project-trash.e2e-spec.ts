import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { LlmService } from '../src/ai/llm.service.js';
import { PrismaService } from '../src/novel/prisma.service.js';

// ESM 下 jest 不注入全局对象，改用 import.meta.jest（@types/jest 已声明其类型）
const jest = import.meta.jest;

const answers = { genre: 'xuanhuan', length: 'short', tone: '热血', pov: '第一人称' };

describe('项目回收站 API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // e2e 套件共享同一个测试库且并行执行，只清理本用例创建的数据
  const owned: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService)
      .useValue({
        hasApiKey: () => true,
        completeStructured: jest.fn(),
        complete: jest.fn(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (owned.length) {
      await prisma.project.deleteMany({ where: { id: { in: owned } } });
    }
    await app.close();
  });

  const createProject = async (title: string) => {
    const created = await request(app.getHttpServer())
      .post('/api/novel/projects')
      .send({ title, answers })
      .expect(201);
    owned.push(created.body.id as string);
    return created.body.id as string;
  };

  const idsOf = async (query = '') => {
    const response = await request(app.getHttpServer())
      .get(`/api/novel/projects${query}`)
      .expect(200);
    return response.body.map((item: { id: string }) => item.id) as string[];
  };

  it('软删除后创作入口 404，回收站可见，恢复后回到创作列表', async () => {
    const id = await createProject('回收站往返作品');

    const deleted = await request(app.getHttpServer())
      .delete(`/api/novel/projects/${id}`)
      .expect(200);
    expect(deleted.body.deletedAt).toBeTruthy();

    await request(app.getHttpServer()).get(`/api/novel/projects/${id}`).expect(404);
    expect(await idsOf()).not.toContain(id);

    expect(await idsOf('?scope=trash')).toContain(id);

    await request(app.getHttpServer()).post(`/api/novel/projects/${id}/restore`).expect(201);
    await request(app.getHttpServer()).get(`/api/novel/projects/${id}`).expect(200);
    expect(await idsOf()).toContain(id);
    expect(await idsOf('?scope=trash')).not.toContain(id);
  });

  it('发布状态接口校验请求，支持保存和改回，并在列表及详情中持久化', async () => {
    const id = await createProject('人工发布作品');
    const endpoint = `/api/novel/projects/${id}/publication-status`;
    const original = await request(app.getHttpServer())
      .get(`/api/novel/projects/${id}`)
      .expect(200);
    expect(original.body.publicationStatus).toBe('writing');
    for (const body of [
      {},
      { publicationStatus: 'done' },
      { publicationStatus: null },
      { publicationStatus: 'published', status: 'done' },
    ]) {
      await request(app.getHttpServer()).patch(endpoint).send(body).expect(400);
    }
    await request(app.getHttpServer())
      .patch(endpoint)
      .send({ publicationStatus: 'published' })
      .expect(200, { publicationStatus: 'published' });
    const detail = await request(app.getHttpServer()).get(`/api/novel/projects/${id}`).expect(200);
    expect(detail.body).toMatchObject({
      publicationStatus: 'published',
      status: original.body.status,
      currentStage: original.body.currentStage,
    });
    const list = await request(app.getHttpServer()).get('/api/novel/projects').expect(200);
    expect(list.body.find((p: { id: string }) => p.id === id).publicationStatus).toBe('published');
    await request(app.getHttpServer())
      .patch(endpoint)
      .send({ publicationStatus: 'writing' })
      .expect(200, { publicationStatus: 'writing' });
    await request(app.getHttpServer()).delete(`/api/novel/projects/${id}`).expect(200);
    await request(app.getHttpServer())
      .patch(endpoint)
      .send({ publicationStatus: 'published' })
      .expect(404);
    await request(app.getHttpServer())
      .patch('/api/novel/projects/missing/publication-status')
      .send({ publicationStatus: 'published' })
      .expect(404);
  });

  it('重复软删除返回 404', async () => {
    const id = await createProject('重复删除作品');
    await request(app.getHttpServer()).delete(`/api/novel/projects/${id}`).expect(200);
    await request(app.getHttpServer()).delete(`/api/novel/projects/${id}`).expect(404);
  });

  it('生成中的项目拒绝软删除，返回 409', async () => {
    const id = await createProject('运行中作品');
    await prisma.project.update({
      where: { id },
      data: { status: 'running', runId: 'e2e-run-lock' },
    });

    const response = await request(app.getHttpServer())
      .delete(`/api/novel/projects/${id}`)
      .expect(409);
    expect(response.body.message).toContain('正在生成');

    // 复位以便其它入口可用
    await prisma.project.update({ where: { id }, data: { status: 'idle', runId: null } });
  });

  it('未进入回收站的项目不能永久删除，进入后可彻底清理', async () => {
    const id = await createProject('待清理作品');
    await request(app.getHttpServer()).delete(`/api/novel/projects/${id}/permanent`).expect(404);

    await request(app.getHttpServer()).delete(`/api/novel/projects/${id}`).expect(200);
    await request(app.getHttpServer()).delete(`/api/novel/projects/${id}/permanent`).expect(200);
    await request(app.getHttpServer()).get(`/api/novel/projects/${id}`).expect(404);
    expect(await prisma.project.count({ where: { id } })).toBe(0);
  });

  it('清空回收站必须带 scope=trash，并只清理回收站项目', async () => {
    const kept = await createProject('清空用例保留作品');
    const doomed = await createProject('清空用例目标作品');
    await request(app.getHttpServer()).delete(`/api/novel/projects/${doomed}`).expect(200);

    await request(app.getHttpServer()).delete('/api/novel/projects').expect(400);

    const cleared = await request(app.getHttpServer())
      .delete('/api/novel/projects?scope=trash')
      .expect(200);
    expect(cleared.body.removed).toBeGreaterThanOrEqual(1);

    expect(await idsOf()).toContain(kept);
    expect(await prisma.project.count({ where: { id: doomed } })).toBe(0);
    expect(await prisma.project.count({ where: { id: kept } })).toBe(1);
  });
});
