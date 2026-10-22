import fs from 'fs';
import os from 'os';
import path from 'path';
import { BadRequestException } from '@nestjs/common';
import { END, START } from '@langchain/langgraph';
import { QuestionnaireAnswers, Stage } from '@rill/shared';
import { createCheckpointer } from './checkpointer.js';
import {
  buildPipelineGraph,
  compilePipelineGraph,
  nextStage,
  PipelineState,
  routeEntry,
} from './pipeline.graph.js';

function makeAnswers(overrides: Partial<QuestionnaireAnswers> = {}): QuestionnaireAnswers {
  return { genre: 'xuanhuan', length: 'medium', tone: '热血', pov: '第三人称限知', ...overrides };
}

function makeState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    projectId: 'project-1',
    genre: 'xuanhuan',
    mode: 'manual',
    currentStage: 'premise',
    answers: makeAnswers(),
    ...overrides,
  };
}

describe('buildPipelineGraph', () => {
  it('把已实现的四个阶段注册为节点', () => {
    const graph = buildPipelineGraph({
      stages: ['premise', 'world', 'characters', 'relations'],
      runner: async () => ({}),
    });

    expect(Object.keys(graph.nodes)).toEqual(
      expect.arrayContaining(['premise', 'world', 'characters', 'relations']),
    );
  });

  it('节点执行时把所处阶段传给 runner', async () => {
    const seen: Stage[] = [];
    const graph = buildPipelineGraph({
      stages: ['premise'],
      runner: async (_state, stage) => {
        seen.push(stage);
        return {};
      },
    });
    graph.addEdge(START, 'premise').addEdge('premise', END);

    await graph.compile().invoke(makeState());

    expect(seen).toEqual(['premise']);
  });

  it('从 currentStage 指定的阶段开始执行', async () => {
    const seen: Stage[] = [];
    const graph = buildPipelineGraph({
      stages: ['premise', 'world', 'characters', 'relations'],
      runner: async (_state, stage) => {
        seen.push(stage);
        return {};
      },
    });

    await graph.compile().invoke(makeState({ currentStage: 'characters' }));

    expect(seen).toEqual(['characters', 'relations']);
  });

  it('跳过类型的阶段不出现在执行序列中', async () => {
    const seen: Stage[] = [];
    // 都市类型：stagesFor 已剔除 world
    const graph = buildPipelineGraph({
      stages: ['premise', 'characters', 'relations'],
      skipStages: ['world'],
      runner: async (_state, stage) => {
        seen.push(stage);
        return {};
      },
    });

    await graph.compile().invoke(makeState({ currentStage: 'premise' }));

    expect(seen).toEqual(['premise', 'characters', 'relations']);
    expect(seen).not.toContain('world');
  });
});

describe('nextStage', () => {
  it('未跳过时进入下一阶段', () => {
    expect(nextStage('premise', ['premise', 'world', 'characters'])).toBe('world');
  });

  it('stages 已剔除 world 时直接到 characters', () => {
    expect(nextStage('premise', ['premise', 'characters', 'relations'])).toBe('characters');
  });

  it('stages 含 world 但被声明跳过时也跳过', () => {
    expect(nextStage('premise', ['premise', 'world', 'characters'], ['world'])).toBe('characters');
  });

  it('最后一个阶段后结束', () => {
    expect(nextStage('relations', ['premise', 'characters', 'relations'])).toBe(END);
  });
});

describe('routeEntry', () => {
  const stages: Stage[] = ['premise', 'world', 'characters', 'relations'];

  it('首次启动路由到首个阶段', () => {
    expect(routeEntry(makeState({ currentStage: 'premise' }), stages)).toBe('premise');
  });

  it('失败续跑路由到失败阶段', () => {
    expect(routeEntry(makeState({ currentStage: 'relations' }), stages)).toBe('relations');
  });

  it('显式重生成路由到指定阶段', () => {
    expect(routeEntry(makeState({ currentStage: 'world' }), stages)).toBe('world');
  });

  it('回退后重跑路由到回退目标阶段', () => {
    expect(routeEntry(makeState({ currentStage: 'premise' }), stages)).toBe('premise');
  });

  it('currentStage 不在编排列表时回退到首个阶段', () => {
    expect(routeEntry(makeState({ currentStage: 'beats' }), stages)).toBe('premise');
  });

  it('编排列表为空时结束', () => {
    expect(routeEntry(makeState(), [])).toBe(END);
  });
});

describe('compilePipelineGraph 的推进模式', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-mode-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function options(seen: Stage[], stages: Stage[]) {
    return {
      stages,
      runner: async (_state: PipelineState, stage: Stage) => {
        seen.push(stage);
        return {};
      },
      checkpointer: createCheckpointer(path.join(dir, 'cp.db')),
    };
  }

  it('manual 模式在阶段后暂停，恢复后才继续下一阶段', async () => {
    const seen: Stage[] = [];
    const graph = compilePipelineGraph({
      ...options(seen, ['premise', 'world', 'characters']),
      mode: 'manual',
    });

    await graph.invoke(makeState(), { configurable: { thread_id: 'p1' } });
    expect(seen).toEqual(['premise']);

    await graph.invoke(null, { configurable: { thread_id: 'p1' } });
    expect(seen).toEqual(['premise', 'world']);
  });

  it('manual 模式最后一个阶段完成后不再暂停', async () => {
    const seen: Stage[] = [];
    const graph = compilePipelineGraph({ ...options(seen, ['premise', 'world']), mode: 'manual' });

    await graph.invoke(makeState(), { configurable: { thread_id: 'p2' } });
    expect(seen).toEqual(['premise']);

    await graph.invoke(null, { configurable: { thread_id: 'p2' } });
    expect(seen).toEqual(['premise', 'world']);
  });

  it('auto 模式一次执行完全部阶段', async () => {
    const seen: Stage[] = [];
    const graph = compilePipelineGraph({
      ...options(seen, ['premise', 'world', 'characters']),
      mode: 'auto',
    });

    await graph.invoke(makeState(), { configurable: { thread_id: 'p3' } });
    expect(seen).toEqual(['premise', 'world', 'characters']);
  });
});

describe('未实现阶段的占位节点', () => {
  it('为 outline/beats/prose 注册占位节点', () => {
    const graph = buildPipelineGraph({
      stages: ['premise', 'world', 'characters', 'relations', 'outline', 'beats', 'prose'],
      runner: async () => ({}),
    });

    expect(Object.keys(graph.nodes)).toEqual(expect.arrayContaining(['outline', 'beats', 'prose']));
  });

  it('执行到未实现阶段时抛出尚未实现而非崩溃', async () => {
    const graph = compilePipelineGraph({
      stages: ['premise', 'outline'],
      runner: async (_state: PipelineState, stage: Stage) => {
        if (stage === 'outline') {
          throw new BadRequestException(`阶段 ${stage} 的生成能力尚未实现（留给后续 change）`);
        }
        return {};
      },
      mode: 'auto',
    });

    await expect(graph.invoke(makeState())).rejects.toThrow('尚未实现');
  });
});
