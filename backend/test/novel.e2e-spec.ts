import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Premise } from '@rill/shared';
import { AppModule } from '../src/app.module';
import { LlmService } from '../src/ai/llm.service';
import { PrismaService } from '../src/novel/prisma.service';

const premise: Premise = {
  title: '临安十二时',
  logline: '南宋临安，被革职的仵作与女说书人联手破案。',
  theme: '真相与偏见',
  coreConflict: '市井仵作与权贵之间的真相之争',
  protagonist: {
    name: '沈砚',
    identity: '被革职的仵作',
    desire: '重查二十年前的旧案',
    flaw: '过度执拗',
  },
  setting: { era: '南宋', place: '临安城', socialBackground: '市井繁华、权贵倾轧' },
  hook: '每桩"闹鬼"命案背后都是人为布局',
  taboos: ['血腥描写'],
};

const answers = { genre: 'xuanhuan', length: 'short', tone: '热血', pov: '第一人称' };

describe('创作流水线 API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const completeStructured = jest.fn().mockResolvedValue(premise);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService)
      .useValue({
        hasApiKey: () => true,
        completeStructured,
        complete: jest.fn(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = moduleRef.get(PrismaService);
    await prisma.premise.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('获取问卷结构，含类型级联项', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/novel/questionnaire?genre=xuanhuan')
      .expect(200);

    expect(response.body.version).toBe('v1');
    expect(
      response.body.questions.some((q: { key: string }) => q.key === 'extras.goldenFinger'),
    ).toBe(true);
  });

  it('未知类型返回 404，非法问卷返回 400 且带字段原因', async () => {
    await request(app.getHttpServer())
      .get('/api/novel/questionnaire?genre=not-a-genre')
      .expect(404);

    const invalid = await request(app.getHttpServer())
      .post('/api/novel/projects')
      .send({
        title: 'x',
        answers: { genre: 'not-a-genre', length: 'short', tone: '热血', pov: '第一人称' },
      })
      .expect(400);
    expect(invalid.body.message).toContain('genre');
  });

  it('创建项目后可按 id 查回，落在首个阶段', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/novel/projects')
      .send({ title: '测试作品', answers })
      .expect(201);

    const id = created.body.id;
    const got = await request(app.getHttpServer()).get(`/api/novel/projects/${id}`).expect(200);

    expect(got.body.currentStage).toBe('premise');
    expect(got.body.premise.status).toBe('pending');
  });

  it('必答项缺失时创建被拒绝', async () => {
    await request(app.getHttpServer())
      .post('/api/novel/projects')
      .send({ title: '缺答案', answers: { genre: 'xuanhuan' } })
      .expect(400);
  });

  it('生成 → 确认 → 推进到下一阶段', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/novel/projects')
      .send({ title: '流程测试', answers })
      .expect(201);
    const id = created.body.id;

    const generated = await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/generate`)
      .send({ wait: true })
      .expect(201);
    expect(generated.body.started).toBe(true);

    const afterGenerate = await request(app.getHttpServer())
      .get(`/api/novel/projects/${id}`)
      .expect(200);
    expect(afterGenerate.body.premise.status).toBe('done');

    const confirmed = await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/confirm`)
      .expect(201);
    expect(confirmed.body.currentStage).toBe('world');
  });

  it('生成接口立即返回，不等模型执行完成', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/novel/projects')
      .send({ title: '异步测试', answers })
      .expect(201);

    const startedAt = Date.now();
    const response = await request(app.getHttpServer())
      .post(`/api/novel/projects/${created.body.id}/generate`)
      .send({})
      .expect(201);
    const elapsed = Date.now() - startedAt;

    expect(response.body.started).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it('人物与关系查询接口返回数据', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/novel/projects')
      .send({ title: '查询测试', answers })
      .expect(201);
    const id = created.body.id;

    await prisma.character.createMany({
      data: [
        { projectId: id, name: '沈砚秋', role: 'protagonist', data: '{}', status: 'done' },
        { projectId: id, name: '沈九', role: 'supporting', data: '{}', status: 'done' },
      ],
    });
    const characters = await prisma.character.findMany({ where: { projectId: id } });
    await prisma.relation.create({
      data: {
        projectId: id,
        fromId: characters[0].id,
        toId: characters[1].id,
        type: '亲人',
        fromRole: '女儿',
        toRole: '父亲',
        description: '父女',
        status: 'done',
      },
    });

    const characterList = await request(app.getHttpServer())
      .get(`/api/novel/projects/${id}/characters`)
      .expect(200);
    expect(characterList.body).toHaveLength(2);
    expect(characterList.body[0].name).toBe('沈砚秋');

    const relationList = await request(app.getHttpServer())
      .get(`/api/novel/projects/${id}/relations`)
      .expect(200);
    expect(relationList.body).toHaveLength(1);
    expect(relationList.body[0].fromRole).toBe('女儿');
    expect(relationList.body[0].toRole).toBe('父亲');
  });

  it('确认后阶段推进到 world 且生成接口可达', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/novel/projects')
      .send({ title: '阶段测试', answers })
      .expect(201);
    const id = created.body.id;

    await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/generate`)
      .send({ wait: true })
      .expect(201);
    await request(app.getHttpServer()).post(`/api/novel/projects/${id}/confirm`).expect(201);

    const project = await request(app.getHttpServer()).get(`/api/novel/projects/${id}`).expect(200);
    expect(project.body.currentStage).toBe('world');

    // world 生成器已注册：接口应受理（mock 返回不合结构，最终以失败告终，但不再是「尚未实现」）
    const response = await request(app.getHttpServer())
      .post(`/api/novel/projects/${id}/generate`)
      .send({ wait: true });
    expect(response.body.message ?? '').not.toContain('尚未实现');
  });
});
