import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { QuestionnaireAnswers } from '@rill/shared';
import { PrismaService } from '../prisma.service';
import { QuestionnaireService } from '../questionnaire/questionnaire';
import { ArtifactRegistry } from '../premise/artifact.registry';
import type { PremiseGenerator } from '../premise/premise.generator';
import { PipelineService } from './pipeline.service';

process.env.DATABASE_URL = `file:${join(__dirname, '../../../pipeline-test.db')}`;

const answers: QuestionnaireAnswers = {
  genre: 'xuanhuan',
  length: 'short',
  tone: '热血',
  pov: '第一人称',
};

describe('PipelineService', () => {
  let prisma: PrismaService;
  let artifacts: ArtifactRegistry;
  let generateMock: jest.Mock;
  let service: PipelineService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.premise.deleteMany();
    await prisma.project.deleteMany();

    artifacts = new ArtifactRegistry();
    generateMock = jest.fn().mockResolvedValue(undefined);
    const generator = {
      generate: generateMock,
    } as unknown as PremiseGenerator;

    service = new PipelineService(prisma, new QuestionnaireService(), generator, artifacts);
  });

  it('创建项目后落在首个阶段且种子为待生成', async () => {
    const project = await service.create({ title: '测试作品', answers });
    expect(project.currentStage).toBe('premise');
    expect(project.status).toBe('idle');
    expect(project.mode).toBe('manual');

    const full = await service.get(project.id);
    expect(full.premise?.status).toBe('pending');
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
    expect(after.premise?.stale).toBe(false);
  });

  it('已完成的阶段未强制时不重复生成', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });

    const result = await service.generate(project.id);
    expect(result.started).toBe(false);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('强制重新生成时会再次生成', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });
    await service.generate(project.id, { force: true, wait: true });
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('生成中重复触发会被拒绝（并发防护）', async () => {
    const project = await service.create({ title: '测试作品', answers });
    let release: () => void = () => undefined;
    generateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await service.generate(project.id); // 不等待，停留在 generating
    await expect(service.generate(project.id)).rejects.toThrow(ConflictException);

    release();
  });

  it('生成失败时标记为 failed 且不写入产物', async () => {
    generateMock.mockRejectedValue(new Error('模型调用失败'));
    const project = await service.create({ title: '测试作品', answers });

    // 等待模式下失败会抛给调用方
    await expect(service.generate(project.id, { wait: true })).rejects.toThrow('模型调用失败');

    const after = await service.get(project.id);
    expect(after.premise?.status).toBe('failed');
    expect(after.premise?.error).toContain('模型调用失败');
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

  it('回退后把下游阶段产物标记为失效', async () => {
    const staleCalls: Array<{ stage: string; stale: boolean }> = [];
    artifacts.register('world', async (_projectId, stale) => {
      staleCalls.push({ stage: 'world', stale });
    });
    artifacts.register('premise', async (_projectId, stale) => {
      staleCalls.push({ stage: 'premise', stale });
    });

    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });
    await service.confirm(project.id); // 推进到 world

    const rolled = await service.rollback(project.id, 'premise');

    expect(rolled.currentStage).toBe('premise');
    // world 在 premise 之后 → 标记失效；premise 自身不标记
    expect(staleCalls).toEqual([{ stage: 'world', stale: true }]);
  });

  it('自动模式在未实现的阶段失败并停在该阶段', async () => {
    const project = await service.create({ title: '测试作品', answers, mode: 'auto' });

    await expect(service.runAuto(project.id)).rejects.toThrow(/尚未实现/);

    const after = await service.get(project.id);
    expect(after.currentStage).toBe('world');
    expect(after.status).toBe('failed');
    // premise 已完成，不会重复生成
    expect(after.premise?.status).toBe('done');
  });

  it('持久化：重新读取仍能得到项目与阶段状态', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });

    // 模拟重启：新建 service 实例读取同一数据库
    const restarted = new PipelineService(
      prisma,
      new QuestionnaireService(),
      { generate: generateMock } as unknown as PremiseGenerator,
      new ArtifactRegistry(),
    );
    const recovered = await restarted.get(project.id);

    expect(recovered.currentStage).toBe('premise');
    expect(recovered.premise?.status).toBe('done');
    expect(JSON.parse(recovered.answers).tone).toBe('热血');
  });
});
