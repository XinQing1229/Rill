import { commitGeneration } from './execution-context.js';
// ESM 下 jest 不注入全局对象，改用 import.meta.jest（@types/jest 已声明其类型）
const jest = import.meta.jest;

import fs from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuestionnaireAnswers, Stage } from '@rill/shared';
import { PrismaService } from '../prisma.service.js';
import { QuestionnaireService } from '../questionnaire/questionnaire.js';
import { ArtifactRegistry, StageGenerator } from './artifact.registry.js';
import { UpstreamAssembler } from './upstream.assembler.js';
import { PipelineService } from './pipeline.service.js';

// 后端为 ESM，测试同样以 ESM 运行，用 import.meta.url 推导目录而非 __dirname
process.env.DATABASE_URL = `file:${join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../pipeline-test.db',
)}`;

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

/** 轮询等待后台生成链条落定（最长 2s） */
async function waitFor(condition: () => Promise<boolean>) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('等待后台链条落定超时');
}

describe('PipelineService', () => {
  let prisma: PrismaService;
  let artifacts: ArtifactRegistry;
  let service: PipelineService;
  let premiseGenerate: jest.Mock;
  let checkpointDir: string;

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

    // 每个用例独立的 checkpoint 库，避免执行快照互相干扰
    checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-svc-'));
    const config = {
      get: () => `file:${path.join(checkpointDir, 'cp.db')}`,
    } as unknown as ConfigService;

    artifacts = new ArtifactRegistry();
    premiseGenerate = jest.fn().mockResolvedValue(undefined);
    artifacts.registerGenerator(fakeGenerator('premise', [], premiseGenerate));
    artifacts.register('premise', async (projectId, stale) => {
      await prisma.premise.updateMany({ where: { projectId }, data: { stale } });
    });
    const assembler = new UpstreamAssembler(prisma, artifacts);
    service = new PipelineService(prisma, new QuestionnaireService(), artifacts, assembler, config);
    await service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    fs.rmSync(checkpointDir, { recursive: true, force: true });
  });

  it('创建项目后落在首个阶段且种子为待生成', async () => {
    const project = await service.create({ title: '测试作品', answers });
    expect(project.currentStage).toBe('premise');

    const full = await service.get(project.id);
    expect(full.premise?.status).toBe('pending');
    expect(full.mode).toBe('manual');
  });

  it('无产物的阶段失败保留错误，空集合成功可确认', async () => {
    const project = await service.create({ title: '阶段状态', answers });
    await service.generate(project.id, { wait: true });
    artifacts.registerGenerator(
      fakeGenerator('world', [], async () => {
        throw new Error('首次失败');
      }),
    );
    await expect(service.confirm(project.id)).rejects.toThrow('首次失败');
    expect((await service.get(project.id)).stageStates.world).toMatchObject({
      status: 'failed',
      error: '首次失败',
    });
    artifacts.registerGenerator(fakeGenerator('world'));
    await service.generate(project.id, { wait: true });
    expect((await service.get(project.id)).stageStates.world.status).toBe('done');
    artifacts.registerGenerator(fakeGenerator('characters'));
    await service.confirm(project.id);
    expect((await service.get(project.id)).currentStage).toBe('characters');
  });

  it('超时后迟到的产物提交被拒绝', async () => {
    const project = await service.create({ title: '迟到任务', answers });
    let release!: () => void;
    let finished!: () => void;
    const settled = new Promise<void>((resolve) => {
      finished = resolve;
    });
    premiseGenerate.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await commitGeneration(prisma, async (tx) => {
          await tx.project.update({ where: { id: project.id }, data: { title: '旧结果' } });
        });
      } finally {
        finished();
      }
    });
    (service as unknown as { generationTimeoutMs: number }).generationTimeoutMs = 50;
    await expect(service.generate(project.id, { wait: true })).rejects.toThrow(/超时/);
    await service.generate(project.id, { wait: true });
    release();
    await settled;
    expect((await service.get(project.id)).title).toBe('迟到任务');
    expect((await service.get(project.id)).status).toBe('idle');
  });

  it('回退清除快照后一次确认进入下一阶段', async () => {
    const project = await service.create({ title: '回退确认', answers });
    artifacts.registerGenerator(fakeGenerator('world'));
    await service.generate(project.id, { wait: true });
    await service.confirm(project.id);
    await service.rollback(project.id, 'premise');
    await service.confirm(project.id);
    expect((await service.get(project.id)).currentStage).toBe('world');
  });

  it('不能回退到尚未完成的阶段', async () => {
    const project = await service.create({ title: '未完成回退', answers });
    await expect(service.rollback(project.id, 'world')).rejects.toThrow('只能回退到已完成阶段');
    expect((await service.get(project.id)).currentStage).toBe('premise');
  });

  it('多选类型持久化、详情与列表读取完整组合，后续生成接收全部类型', async () => {
    const genre: QuestionnaireAnswers['genre'] = ['dushi', 'chaogu', 'chuanyue'];
    const project = await service.create({ title: '组合类型', answers: { ...answers, genre } });
    expect(project.genre).toEqual(genre);
    const detail = await service.get(project.id);
    expect(detail.genre).toEqual(genre);
    expect(detail.stages).toContain('world');
    expect(JSON.parse(detail.answers).genre).toEqual(genre);
    expect((await service.list()).find((item) => item.id === project.id)?.genre).toEqual(genre);
    await service.generate(project.id, { wait: true });
    expect(premiseGenerate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ genre }),
      project.id,
    );
  });

  it('必答项缺失时创建失败', async () => {
    await expect(
      service.create({ title: 'x', answers: { genre: 'xuanhuan' } as QuestionnaireAnswers }),
    ).rejects.toThrow(/还需填写：.*篇幅.*叙事视角/);
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

  it('同时请求生成时只有一个任务能领取运行权', async () => {
    const project = await service.create({ title: '并发测试', answers });
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    premiseGenerate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          started();
        }),
    );
    const results = await Promise.allSettled([
      service.generate(project.id),
      service.generate(project.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await entered;
    expect(premiseGenerate).toHaveBeenCalledTimes(1);
    await expect(service.rollback(project.id, 'premise')).rejects.toThrow(ConflictException);
    await expect(service.setMode(project.id, 'auto')).rejects.toThrow(ConflictException);
    release();
    for (let i = 0; i < 100; i += 1) {
      if ((await service.get(project.id)).runId === null) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });

  it('生成超时后把阶段与项目标记为失败，项目不会卡在 running', async () => {
    const project = await service.create({ title: '超时测试', answers });
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

  it('注入正文服务不会延长手动种子任务的超时', async () => {
    // 生产模块始终注入正文服务，种子仍应使用普通阶段的兜底期限。
    (service as unknown as { prose: object }).prose = { reconcile: async () => undefined };
    (service as unknown as { generationTimeoutMs: number }).generationTimeoutMs = 50;
    const project = await service.create({ title: '种子超时隔离', answers });
    premiseGenerate.mockImplementation(() => new Promise<void>(() => undefined));
    await expect(service.generate(project.id, { wait: true })).rejects.toThrow('生成超时');
    const after = await service.get(project.id);
    expect(after.status).toBe('failed');
    expect(after.stageStates.premise.status).toBe('failed');
  });

  it('已失效的完成产物不会被当作可用产物跳过', async () => {
    const project = await service.create({ title: '失效测试', answers });
    await service.generate(project.id, { wait: true });
    await service.confirm(project.id).catch(() => undefined);

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

  it('确认后推进到下一阶段并生成其产物', async () => {
    artifacts.registerGenerator(fakeGenerator('world', ['premise']));
    artifacts.register('world', async (projectId, stale) => {
      await prisma.worldSetting.updateMany({ where: { projectId }, data: { stale } });
    });
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });
    // 创建世界观行，使该阶段状态可读
    await prisma.worldSetting.create({
      data: { projectId: project.id, data: '{}', status: 'pending' },
    });

    const confirmed = await service.confirm(project.id);
    expect(confirmed.currentStage).toBe('world');
    expect(confirmed.world?.status).toBe('done');
  });

  it('生成完成后停留在当前阶段等待确认，不自动推进', async () => {
    const project = await service.create({ title: '待确认', answers });
    await service.generate(project.id, { wait: true });

    // 产物已完成，但未确认前阶段指针不动
    const after = await service.get(project.id);
    expect(after.currentStage).toBe('premise');
    expect(after.premise?.status).toBe('done');

    // 再次查询仍未被自动推进（待确认状态跨请求保持）
    const again = await service.get(project.id);
    expect(again.currentStage).toBe('premise');
  });

  it('未生成完成时确认会被拒绝', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await expect(service.confirm(project.id)).rejects.toThrow(/尚未生成完成/);
  });

  it('未实现生成器的阶段给出明确提示', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });

    // 确认后图推进到 world，该阶段生成器未实现
    await expect(service.confirm(project.id)).rejects.toThrow(/尚未实现/);
  });

  it('重新生成动作会重跑本阶段', async () => {
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });

    await service.confirm(project.id, 'regenerate');

    expect(premiseGenerate).toHaveBeenCalledTimes(2);
  });

  it('上游失效时拒绝生成下游', async () => {
    const worldGenerate = jest.fn().mockResolvedValue(undefined);
    artifacts.registerGenerator(fakeGenerator('world', ['premise'], worldGenerate));
    artifacts.register('world', async (projectId, stale) => {
      await prisma.worldSetting.updateMany({ where: { projectId }, data: { stale } });
    });

    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });

    // 把种子标记为失效（模拟回退后未重新生成）
    await prisma.premise.update({ where: { projectId: project.id }, data: { stale: true } });

    await expect(service.confirm(project.id)).rejects.toThrow(/已失效/);
    expect(worldGenerate).not.toHaveBeenCalled();
  });

  it('上游未完成时拒绝生成下游', async () => {
    artifacts.registerGenerator(fakeGenerator('world', ['premise']));
    const project = await service.create({ title: '测试作品', answers });

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

    staleCalls.length = 0;
    const rolled = await service.rollback(project.id, 'premise');

    expect(rolled.currentStage).toBe('premise');
    expect(staleCalls).toEqual([
      { stage: 'world', stale: true },
      { stage: 'characters', stale: true },
      { stage: 'relations', stale: true },
    ]);
  });

  it('回退后从回退目标阶段重新开始', async () => {
    artifacts.registerGenerator(fakeGenerator('world', ['premise']));
    artifacts.register('world', async (projectId, stale) => {
      await prisma.worldSetting.updateMany({ where: { projectId }, data: { stale } });
    });
    const project = await service.create({ title: '测试作品', answers });
    await service.generate(project.id, { wait: true });
    await service.confirm(project.id);

    const rolled = await service.rollback(project.id, 'premise');
    expect(rolled.currentStage).toBe('premise');

    // 回退后再次生成：以 premise 为起点，而不是继续此前的中断点
    premiseGenerate.mockClear();
    await service.generate(project.id, { force: true, wait: true });
    expect(premiseGenerate).toHaveBeenCalledTimes(1);
  });

  it('失败续跑时不重复已完成阶段', async () => {
    let worldShouldFail = true;
    let worldCalls = 0;
    artifacts.registerGenerator(
      fakeGenerator('world', ['premise'], async () => {
        worldCalls += 1;
        if (worldShouldFail) throw new Error('世界观生成失败');
      }),
    );
    artifacts.register('world', async (projectId, stale) => {
      await prisma.worldSetting.updateMany({ where: { projectId }, data: { stale } });
    });
    // 创建世界观行，使阶段状态可读
    const project = await service.create({ title: '续跑测试', answers, mode: 'auto' });
    await prisma.worldSetting.create({
      data: { projectId: project.id, data: '{}', status: 'pending' },
    });

    await expect(service.runAuto(project.id)).rejects.toThrow('世界观生成失败');
    const failed = await service.get(project.id);
    expect(failed.currentStage).toBe('world');
    expect(failed.premise?.status).toBe('done');

    // 修复后再次触发：从 world 继续，premise 不再重跑
    worldShouldFail = false;
    premiseGenerate.mockClear();
    // 自动模式会一路推进到未实现的 characters，属预期失败，忽略
    await service.runAuto(project.id).catch(() => undefined);

    expect(premiseGenerate).not.toHaveBeenCalled();
    expect(worldCalls).toBe(2);
    const after = await service.get(project.id);
    expect(after.world?.status).toBe('done');
  });

  it('跳过世界观的类型不生成世界观产物', async () => {
    const characterGenerate = jest.fn().mockResolvedValue(undefined);
    artifacts.registerGenerator(fakeGenerator('characters', ['premise'], characterGenerate));
    artifacts.register('characters', async (projectId, stale) => {
      await prisma.character.updateMany({ where: { projectId }, data: { stale } });
    });

    const project = await service.create({
      title: '都市作品',
      answers: { ...answers, genre: 'dushi' },
      mode: 'auto',
    });

    // 都市类型跳过 world，premise → characters；relations 未实现故最终失败
    await service.runAuto(project.id).catch(() => undefined);

    const after = await service.get(project.id);
    expect(after.stages).not.toContain('world');
    expect(after.world).toBeNull();
    expect(characterGenerate).toHaveBeenCalled();
  });

  it('自动模式在未实现的阶段失败并停在该阶段', async () => {
    const project = await service.create({ title: '测试作品', answers, mode: 'auto' });

    await expect(service.runAuto(project.id)).rejects.toThrow(/尚未实现/);

    const after = await service.get(project.id);
    expect(after.currentStage).toBe('world');
    expect(after.status).toBe('failed');
    expect(after.premise?.status).toBe('done');
  });

  it('自动模式下 generate 触发后台连续推进', async () => {
    const project = await service.create({ title: '自动模式', answers, mode: 'auto' });

    const response = await service.generate(project.id);
    expect(response.started).toBe(true);
    expect(response.auto).toBe(true);

    await waitFor(async () => (await service.get(project.id)).status === 'failed');
    const after = await service.get(project.id);
    expect(after.currentStage).toBe('world');
    expect(after.premise?.status).toBe('done');
  });

  it('项目列表只返回摘要字段且按更新时间倒序', async () => {
    const first = await service.create({ title: '较早', answers });
    await service.create({ title: '较晚', answers });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await prisma.project.update({ where: { id: first.id }, data: { title: '较早-更新' } });

    const list = await service.list();
    expect(list[0].title).toBe('较早-更新');
    expect(list.every((item) => 'currentStage' in item && 'status' in item)).toBe(true);
    expect(list.every((item) => !('answers' in item) && !('premise' in item))).toBe(true);
  });
});
