import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { QuestionnaireAnswers, Stage } from '@rill/shared';
import { PrismaService } from '../prisma.service';
import { QuestionnaireService } from '../questionnaire/questionnaire';
import { ArtifactRegistry, StageGenerator } from './artifact.registry';
import { UpstreamAssembler } from './upstream.assembler';
import { PipelineService } from './pipeline.service';

process.env.DATABASE_URL = `file:${join(__dirname, '../../../pipeline-test.db')}`;

const answers: QuestionnaireAnswers = {
  genre: 'xuanhuan',
  length: 'short',
  tone: '热血',
  pov: '第一人称',
};

function fakeGenerator(
  stage: Stage,
  requires: Stage[] = [],
  impl?: () => Promise<void>,
): StageGenerator {
  return {
    stage,
    requires: () => requires,
    generate: impl ?? (async () => undefined),
  };
}

describe('PipelineService', () => {
  let prisma: PrismaService;
  let artifacts: ArtifactRegistry;
  let service: PipelineService;
  let premiseGenerate: jest.Mock;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // 按外键依赖顺序清理
    await prisma.relation.deleteMany();
    await prisma.character.deleteMany();
    await prisma.worldSetting.deleteMany();
    await prisma.premise.deleteMany();
    await prisma.project.deleteMany();

    artifacts = new ArtifactRegistry();
    premiseGenerate = jest.fn().mockResolvedValue(undefined);
    artifacts.registerGenerator(fakeGenerator('premise', [], premiseGenerate));
    const assembler = new UpstreamAssembler(prisma, artifacts);
    service = new PipelineService(prisma, new QuestionnaireService(), artifacts, assembler);
  });

  it('创建项目后落在首个阶段且种子为待生成', async () => {
    const project = await service.create({ title: '测试作品', answers });
    expect(project.currentStage).toBe('premise');

    const full = await service.get(project.id);
    expect(full.premise?.status).toBe('pending');
    expect(full.mode).toBe('manual');
  });

  it('必答项缺失时创建失败', async () => {
    await expect(
      service.create({ title: 'x', answers: { genre: 'xuanhuan' } as QuestionnaireAnswers }),
    ).rejects.toThrow(/缺少必答项/);
  });

  it('生成完成（等待）后产物状态为 done', async () => {
    const project = await service.create({ title: '测试作品', answers });
    const result = await service.generate(project.id, { wait: true });
    expect(result.started).toBe(true);

    const after = await service.get(project.id);
    expect(after.premise?.status).toBe('done');
    expect(premiseGenerate).toHaveBeenCalledTimes(1);
  });

  it('已完成的阶段未强制时不重复生成', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });

    const result = await service.generate(project.id);
    expect(result.started).toBe(false);
    expect(premiseGenerate).toHaveBeenCalledTimes(1);
  });

  it('强制重新生成时会再次生成', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });
    await service.generate(project.id, { force: true, wait: true });
    expect(premiseGenerate).toHaveBeenCalledTimes(2);
  });

  it('生成中重复触发会被拒绝（项目级并发锁）', async () => {
    const project = await service.create({ title: '测试作品', answers });
    let release: () => void = () => undefined;
    premiseGenerate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await service.generate(project.id);
    await expect(service.generate(project.id)).rejects.toThrow(ConflictException);

    release();
  });

  it('生成超时后把阶段与项目标记为失败，项目不会卡在 running', async () => {
    const project = await service.create({ title: '超时测试', answers });
    // 永不决断的生成任务
    premiseGenerate.mockImplementation(() => new Promise<void>(() => undefined));
    (service as unknown as { generationTimeoutMs: number }).generationTimeoutMs = 50;

    await expect(service.generate(project.id, { wait: true })).rejects.toThrow(/生成超时/);

    const after = await service.get(project.id);
    expect(after.premise?.status).toBe('failed');
    expect(after.premise?.error).toContain('生成超时');
    expect(after.status).toBe('failed');

    // 关键：项目不再卡在 running，后续生成可以再次触发
    premiseGenerate.mockResolvedValue(undefined);
    const retried = await service.generate(project.id, { force: true, wait: true });
    expect(retried.started).toBe(true);
  });

  it('已失效的完成产物不会被当作可用产物跳过', async () => {
    const project = await service.create({ title: '失效测试', answers });
    await service.generate(project.id, { wait: true });
    await service.confirm(project.id);

    // 回退后种子被标记失效，回到 premise 重新生成时应实际触发
    await service.rollback(project.id, 'premise');
    await prisma.premise.update({ where: { projectId: project.id }, data: { stale: true } });
    premiseGenerate.mockClear();

    const result = await service.generate(project.id, { wait: true });

    expect(result.started).toBe(true);
    expect(premiseGenerate).toHaveBeenCalledTimes(1);
  });

  it('生成失败时标记为 failed', async () => {
    premiseGenerate.mockRejectedValue(new Error('模型调用失败'));
    const project = await service.create({ title: '测试作品', answers });

    await expect(service.generate(project.id, { wait: true })).rejects.toThrow('模型调用失败');

    const after = await service.get(project.id);
    expect(after.premise?.status).toBe('failed');
    expect(after.status).toBe('failed');
  });

  it('确认后推进到下一阶段', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });

    const confirmed = await service.confirm(project.id);
    expect(confirmed.currentStage).toBe('world');
  });

  it('未生成完成时确认会被拒绝', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await expect(service.confirm(project.id)).rejects.toThrow(/尚未生成完成/);
  });

  it('未实现生成器的阶段给出明确提示', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });
    await service.confirm(project.id);

    await expect(service.generate(project.id, { wait: true })).rejects.toThrow(/尚未实现/);
  });

  it('上游失效时拒绝生成下游', async () => {
    const worldGenerate = jest.fn().mockResolvedValue(undefined);
    artifacts.registerGenerator(fakeGenerator('world', ['premise'], worldGenerate));
    artifacts.register('world', async (projectId, stale) => {
      await prisma.worldSetting.updateMany({ where: { projectId }, data: { stale } });
    });

    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });
    await service.confirm(project.id);

    // 把种子标记为失效（模拟回退后未重新生成）
    await prisma.premise.update({ where: { projectId: project.id }, data: { stale: true } });

    await expect(service.generate(project.id, { wait: true })).rejects.toThrow(/已失效/);
    expect(worldGenerate).not.toHaveBeenCalled();
  });

  it('上游未完成时拒绝生成下游', async () => {
    artifacts.registerGenerator(fakeGenerator('world', ['premise']));
    const project = await service.create({ title: '测试作品', answers });
    await service.confirm(project.id).catch(() => undefined); // 未生成无法确认，忽略

    // 手动把阶段推到 world 以模拟上游未完成
    await prisma.project.update({ where: { id: project.id }, data: { currentStage: 'world' } });
    await expect(service.generate(project.id, { wait: true })).rejects.toThrow(/尚未完成/);
  });

  it('回退后把下游阶段产物标记为失效', async () => {
    const staleCalls: Array<{ stage: string; stale: boolean }> = [];
    for (const stage of ['world', 'characters', 'relations'] as Stage[]) {
      artifacts.register(stage, async (_projectId, stale) => {
        staleCalls.push({ stage, stale });
      });
    }

    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });
    await service.confirm(project.id);

    // 生成本身也会标记下游失效，清空后只观察回退的行为
    staleCalls.length = 0;
    const rolled = await service.rollback(project.id, 'premise');

    expect(rolled.currentStage).toBe('premise');
    // premise 自身不标记，其后所有阶段均被标记失效
    expect(staleCalls).toEqual([
      { stage: 'world', stale: true },
      { stage: 'characters', stale: true },
      { stage: 'relations', stale: true },
    ]);
  });

  it('重新生成人物时联动把关系标记为失效', async () => {
    const staleCalls: Array<{ stage: string; stale: boolean }> = [];
    for (const stage of ['world', 'characters', 'relations'] as Stage[]) {
      artifacts.register(stage, async (_projectId, stale) => {
        staleCalls.push({ stage, stale });
      });
    }
    // characters 阶段有生成器（premise 之后注册）
    artifacts.registerGenerator(fakeGenerator('characters', ['premise']));
    artifacts.registerGenerator(fakeGenerator('world', ['premise']));

    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });
    await service.confirm(project.id);

    // 推进到 characters 并完成，再回到 premise 重新生成
    await prisma.project.update({
      where: { id: project.id },
      data: { currentStage: 'characters' },
    });
    await service.generate(project.id, { wait: true });
    await prisma.project.update({ where: { id: project.id }, data: { currentStage: 'premise' } });

    staleCalls.length = 0;
    await service.generate(project.id, { force: true, wait: true });

    // premise 的下游全部被标记失效（含 characters 与 relations）
    expect(staleCalls).toEqual([
      { stage: 'world', stale: true },
      { stage: 'characters', stale: true },
      { stage: 'relations', stale: true },
    ]);
  });

  it('自动模式在未实现的阶段失败并停在该阶段', async () => {
    const project = await service.create({ title: '测试作品', answers, mode: 'auto' });

    await expect(service.runAuto(project.id)).rejects.toThrow(/尚未实现/);

    const after = await service.get(project.id);
    expect(after.currentStage).toBe('world');
    expect(after.status).toBe('failed');
    expect(after.premise?.status).toBe('done');
  });

  it('持久化：重新读取仍能得到项目与阶段状态', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });

    const restarted = new PipelineService(
      prisma,
      new QuestionnaireService(),
      new ArtifactRegistry(),
      new UpstreamAssembler(prisma, new ArtifactRegistry()),
    );
    const recovered = await restarted.get(project.id);

    expect(recovered.currentStage).toBe('premise');
    expect(recovered.premise?.status).toBe('done');
    expect(JSON.parse(recovered.answers).tone).toBe('热血');
  });

  it('人物与关系查询接口返回对应数据', async () => {
    const project = await service.create({ title: '测试作品', answers });

    await prisma.character.createMany({
      data: [
        { projectId: project.id, name: '沈砚秋', role: 'protagonist', data: '{}', status: 'done' },
        { projectId: project.id, name: '沈九', role: 'supporting', data: '{}', status: 'done' },
      ],
    });
    const characters = await prisma.character.findMany({ where: { projectId: project.id } });
    await prisma.relation.create({
      data: {
        projectId: project.id,
        fromId: characters[0].id,
        toId: characters[1].id,
        type: '亲人',
        fromRole: '女儿',
        toRole: '父亲',
        description: '父女',
        status: 'done',
      },
    });

    const list = await service.characters(project.id);
    const relations = await service.relations(project.id);

    expect(list).toHaveLength(2);
    expect(relations).toHaveLength(1);
    expect(relations[0].fromRole).toBe('女儿');
  });
});
