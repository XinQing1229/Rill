// ESM 下 jest 不注入全局对象，改用 import.meta.jest（@types/jest 已声明其类型）
const jest = import.meta.jest;

import { BadRequestException } from '@nestjs/common';
import { QuestionnaireAnswers, Stage, StageContext } from '@rill/shared';
import { PrismaService } from '../prisma.service.js';
import { ArtifactRegistry } from './artifact.registry.js';
import { UpstreamAssembler } from './upstream.assembler.js';
import { createStageRunner, StageRunnerDeps } from './stage.runner.js';
import { PipelineState } from './pipeline.graph.js';

const ANSWERS: QuestionnaireAnswers = {
  genre: 'xuanhuan',
  length: 'short',
  tone: '热血',
  pov: '第三人称限知',
};

function makeState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    projectId: 'project-1',
    genre: 'xuanhuan',
    mode: 'manual',
    currentStage: 'premise',
    answers: ANSWERS,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<StageRunnerDeps> = {}): StageRunnerDeps {
  const prisma = {
    stageRun: { upsert: jest.fn().mockResolvedValue({}) },
    project: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ runId: 'test' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'project-1' }),
      update: jest.fn().mockResolvedValue({ id: 'project-1' }),
    },
    premise: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    worldSetting: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    character: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    relation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  Object.assign(prisma, {
    $transaction: async (write: (tx: typeof prisma) => Promise<void>) => write(prisma),
  });
  const assembler = {
    readStageState: jest.fn().mockReturnValue({ status: 'pending', stale: false }),
    assemble: jest.fn().mockResolvedValue({} as StageContext),
  };
  const artifacts = {
    getGenerator: jest.fn().mockReturnValue({ generate: jest.fn().mockResolvedValue(undefined) }),
    setStale: jest.fn().mockResolvedValue(undefined),
  };

  return {
    prisma: prisma as unknown as PrismaService,
    assembler: assembler as unknown as UpstreamAssembler,
    artifacts: artifacts as unknown as ArtifactRegistry,
    ...overrides,
  };
}

describe('createStageRunner', () => {
  it('产物已完成且未失效时跳过生成，不调用模型', async () => {
    const deps = makeDeps();
    (deps.assembler.readStageState as jest.Mock).mockReturnValue({ status: 'done', stale: false });

    const runner = createStageRunner(deps);
    const patch = await runner(makeState(), 'premise');

    expect(patch).toEqual({ currentStage: 'premise' });
    expect(deps.artifacts.getGenerator).not.toHaveBeenCalled();
    expect(deps.prisma.premise.updateMany).not.toHaveBeenCalled();
  });

  it('产物失效时重新生成', async () => {
    const deps = makeDeps();
    (deps.assembler.readStageState as jest.Mock).mockReturnValue({ status: 'done', stale: true });

    await createStageRunner(deps)(makeState(), 'premise');

    expect(deps.artifacts.getGenerator).toHaveBeenCalledWith('premise');
  });

  it('按 装配上游 → 生成 → 置 done 的顺序执行', async () => {
    const deps = makeDeps();
    const generate = jest.fn().mockResolvedValue(undefined);
    (deps.artifacts.getGenerator as jest.Mock).mockReturnValue({ generate });

    await createStageRunner(deps)(makeState(), 'premise');

    expect(deps.assembler.assemble).toHaveBeenCalledWith('project-1', 'premise');
    expect(generate).toHaveBeenCalledWith({}, ANSWERS, 'project-1');
    const statuses = (deps.prisma.premise.updateMany as jest.Mock).mock.calls.map(
      (call) => call[0].data.status,
    );
    expect(statuses).toEqual(['generating', 'done']);
  });

  it('生成失败时置 failed 并抛出，使图停在失败阶段', async () => {
    const deps = makeDeps();
    (deps.artifacts.getGenerator as jest.Mock).mockReturnValue({
      generate: jest.fn().mockRejectedValue(new Error('模型调用失败')),
    });

    await expect(createStageRunner(deps)(makeState(), 'premise')).rejects.toThrow('模型调用失败');

    const last = (deps.prisma.premise.updateMany as jest.Mock).mock.calls.at(-1)?.[0].data;
    expect(last.status).toBe('failed');
    expect(last.error).toContain('模型调用失败');
  });

  it('重新生成时把下游阶段标记为失效', async () => {
    const deps = makeDeps();

    await createStageRunner(deps)(makeState(), 'premise');

    const staleStages = (deps.artifacts.setStale as jest.Mock).mock.calls.map((call) => call[0]);
    expect(staleStages).toContain('world');
    expect(staleStages).toContain('characters');
  });

  it('阶段生成器未实现时抛出尚未实现而非崩溃', async () => {
    const deps = makeDeps();
    (deps.artifacts.getGenerator as jest.Mock).mockReturnValue(undefined);

    await expect(createStageRunner(deps)(makeState(), 'outline' as Stage)).rejects.toThrow(
      BadRequestException,
    );

    const last = (deps.prisma.premise.updateMany as jest.Mock).mock.calls.at(-1)?.[0].data;
    expect(last).toBeUndefined();
  });
});
