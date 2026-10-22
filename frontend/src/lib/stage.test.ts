import { describe, expect, it } from 'vitest';
import {
  firstUnreadyUpstream,
  isPollingSettled,
  readStageState,
  timelineStages,
  upstreamRequires,
} from './stage';
import {
  makeCharacterRow,
  makePremiseRow,
  makeProject,
  makeRelationRow,
  makeWorldRow,
} from '../test/fixtures';

describe('readStageState（与后端 UpstreamAssembler 同口径）', () => {
  it('1:1 阶段直读行状态', () => {
    const project = makeProject({
      premise: { ...makeProject().premise!, status: 'done', stale: true },
    });
    expect(readStageState(project, 'premise')).toEqual({ status: 'done', stale: true });
  });

  it('1:N 全部完成才算完成', () => {
    const project = makeProject({
      characters: [makeCharacterRow('甲', 'protagonist'), makeCharacterRow('乙', 'supporting')],
    });
    expect(readStageState(project, 'characters')).toEqual({ status: 'done', stale: false });
  });

  it('1:N 任一 stale 即视为失效', () => {
    const project = makeProject({
      characters: [
        makeCharacterRow('甲', 'protagonist'),
        makeCharacterRow('乙', 'supporting', { stale: true }),
      ],
    });
    expect(readStageState(project, 'characters')?.stale).toBe(true);
  });

  it('1:N 任一失败即失败', () => {
    const project = makeProject({
      characters: [
        makeCharacterRow('甲', 'protagonist'),
        makeCharacterRow('乙', 'supporting', { status: 'failed' }),
      ],
    });
    expect(readStageState(project, 'characters')?.status).toBe('failed');
  });

  it('1:N 全部 pending 报 pending（而非 generating）', () => {
    const project = makeProject({
      characters: [
        makeCharacterRow('甲', 'protagonist', { status: 'pending' }),
        makeCharacterRow('乙', 'supporting', { status: 'pending' }),
      ],
    });
    expect(readStageState(project, 'characters')).toEqual({ status: 'pending', stale: false });
  });

  it('无产物行返回 undefined', () => {
    expect(readStageState(makeProject(), 'relations')).toBeUndefined();
  });
});

describe('upstreamRequires（与后端生成器 requires() 一致）', () => {
  it('世界观依赖种子', () => {
    expect(upstreamRequires('world', ['premise', 'world'])).toEqual(['premise']);
  });

  it('人物依赖种子与世界观（有世界观阶段时）', () => {
    expect(upstreamRequires('characters', ['premise', 'world', 'characters'])).toEqual([
      'premise',
      'world',
    ]);
  });

  it('跳过世界观的类型人物只依赖种子', () => {
    expect(upstreamRequires('characters', ['premise', 'characters'])).toEqual(['premise']);
  });
});

describe('firstUnreadyUpstream', () => {
  it('上游缺失时阻止', () => {
    const project = makeProject(); // premise pending
    expect(firstUnreadyUpstream(project, 'world')).toEqual({
      stage: 'premise',
      reason: 'not-done',
    });
  });

  it('上游失效时阻止', () => {
    const project = makeProject({
      premise: { ...makeProject().premise!, status: 'done', stale: true },
    });
    expect(firstUnreadyUpstream(project, 'world')?.reason).toBe('stale');
  });

  it('上游齐备时不阻止', () => {
    const project = makeProject({
      premise: makePremiseRow({ status: 'done' }),
      world: makeWorldRow({ status: 'done' }),
    });
    expect(firstUnreadyUpstream(project, 'characters')).toBeUndefined();
  });
});

describe('isPollingSettled', () => {
  it('running 不停', () => {
    expect(isPollingSettled(makeProject({ status: 'running' }))).toBe(false);
  });

  it('当前阶段 generating 不停', () => {
    const project = makeProject({
      status: 'running',
      premise: { ...makeProject().premise!, status: 'generating' },
    });
    expect(isPollingSettled(project)).toBe(false);
  });

  it('auto 链条阶段间隙（idle + 已完成）不停', () => {
    const project = makeProject({
      mode: 'auto',
      status: 'idle',
      currentStage: 'world',
      premise: { ...makeProject().premise!, status: 'done' },
    });
    expect(isPollingSettled(project)).toBe(false);
  });

  it('auto 新项目（idle + 待生成）停', () => {
    expect(isPollingSettled(makeProject({ mode: 'auto' }))).toBe(true);
  });

  it('终态停', () => {
    expect(isPollingSettled(makeProject({ status: 'failed' }))).toBe(true);
    expect(isPollingSettled(makeProject({ status: 'done' }))).toBe(true);
  });
});

describe('timelineStages', () => {
  it('跳过世界观的类型不出现在时间轴', () => {
    expect(timelineStages(['premise', 'characters', 'relations'])).toEqual([
      'premise',
      'characters',
    ]);
  });
});

describe('关系聚合', () => {
  it('关系行缺失时 characters 面板的关系区为空', () => {
    const project = makeProject();
    expect(project.relations).toEqual([]);
  });

  it('关系行参与阶段状态聚合', () => {
    const project = makeProject({
      relations: [makeRelationRow('a', 'b', { status: 'failed' })],
    });
    expect(readStageState(project, 'relations')?.status).toBe('failed');
  });
});
