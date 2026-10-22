import fs from 'fs';
import os from 'os';
import path from 'path';
import { QuestionnaireAnswers, Stage } from '@rill/shared';
import { buildPipelineGraph, PipelineState } from './pipeline.graph.js';
import { createCheckpointer, deleteCheckpointThread, toSqlitePath } from './checkpointer.js';

function makeState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    projectId: 'project-1',
    genre: 'xuanhuan',
    mode: 'manual',
    currentStage: 'premise',
    answers: {
      genre: 'xuanhuan',
      length: 'medium',
      tone: '热血',
      pov: '第三人称限知',
    } as QuestionnaireAnswers,
    ...overrides,
  };
}

describe('toSqlitePath', () => {
  it('剥离 file: 前缀', () => {
    expect(toSqlitePath('file:./checkpoints.db')).toBe('./checkpoints.db');
  });

  it('普通路径原样返回', () => {
    expect(toSqlitePath('/abs/checkpoints.db')).toBe('/abs/checkpoints.db');
  });
});

describe('流水线 checkpointer', () => {
  const stages: Stage[] = ['premise', 'world', 'characters', 'relations'];
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-cp-'));
    file = path.join(dir, 'checkpoints.db');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('全新库删除未知线程不会因未建表失败', async () => {
    await expect(
      deleteCheckpointThread(createCheckpointer(file), 'missing'),
    ).resolves.toBeUndefined();
  });

  it('重启后从中断处继续，且不重复已完成阶段', async () => {
    const seen: Stage[] = [];
    const build = () =>
      buildPipelineGraph({
        stages,
        runner: async (_state: PipelineState, stage: Stage) => {
          seen.push(stage);
          return {};
        },
      });

    // 第一次执行：在 characters 之前中断
    const first = build().compile({
      checkpointer: createCheckpointer(file),
      interruptBefore: ['characters'],
    });
    await first.invoke(makeState(), { configurable: { thread_id: 'project-1' } });
    expect(seen).toEqual(['premise', 'world']);

    // 模拟重启：丢弃旧实例，用新的 checkpointer 与新图恢复
    const second = build().compile({ checkpointer: createCheckpointer(file) });
    await second.invoke(null, { configurable: { thread_id: 'project-1' } });

    // 从中断处继续，premise 与 world 不重复执行
    expect(seen).toEqual(['premise', 'world', 'characters', 'relations']);
    expect(seen.filter((stage) => stage === 'premise')).toHaveLength(1);
    expect(seen.filter((stage) => stage === 'world')).toHaveLength(1);
  });

  it('不同项目的执行快照相互隔离', async () => {
    const seen: Record<string, Stage[]> = { a: [], b: [] };
    const build = () =>
      buildPipelineGraph({
        stages: ['premise', 'world'],
        runner: async (state: PipelineState, stage: Stage) => {
          seen[state.projectId].push(stage);
          return {};
        },
      });

    const graph = build().compile({
      checkpointer: createCheckpointer(file),
      interruptBefore: ['world'],
    });

    await graph.invoke(makeState({ projectId: 'a' }), { configurable: { thread_id: 'a' } });
    await graph.invoke(makeState({ projectId: 'b' }), { configurable: { thread_id: 'b' } });

    expect(seen.a).toEqual(['premise']);
    expect(seen.b).toEqual(['premise']);
  });
});
