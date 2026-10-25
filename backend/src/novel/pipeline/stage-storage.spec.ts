import type { StageContext } from '@rill/shared';
import { contextFor, type StageSnapshot } from './stage-storage.js';

const snapshot = (overrides: Partial<StageSnapshot> = {}): StageSnapshot => ({
  outline: {
    stale: false,
    revision: 3,
    confirmedRevision: 3,
    planData: JSON.stringify({
      mainline: '追查失踪案',
      turningPoints: ['发现内鬼'],
      climax: '揭穿内鬼',
      ending: '案件告破',
      characterArcs: [{ characterId: 'c1', development: '从怀疑到信任' }],
      relationDevelopments: [],
      segments: [
        {
          id: 'act',
          title: '调查',
          goal: '找到证据',
          events: '循线追查',
          outcome: '锁定真凶',
          startChapter: 1,
          endChapter: 1,
        },
      ],
    }),
    batches: [
      {
        planRevision: 3,
        status: 'done',
        data: JSON.stringify({
          chapters: [
            {
              number: 1,
              segmentId: 'act',
              title: '线索',
              events: '主角发现证据',
              characterIds: ['c1'],
              conflict: '证人隐瞒',
              outcome: '证人改口',
              consequence: '追查证物来源',
            },
          ],
        }),
      },
    ],
    planRevision: 3,
  },
  ...overrides,
});

describe('大纲直接供正文使用的上下文', () => {
  it('没有节拍时也提供完整且已确认的章纲', () => {
    const context = contextFor(snapshot());
    expect(context.outline?.chapters).toHaveLength(1);
    expect(context.outline?.chapters[0].events).toBe('主角发现证据');
    expect(context).not.toHaveProperty('beats');
  });
  it.each([
    ['未确认大纲', { outline: { ...snapshot().outline!, confirmedRevision: null } }],
    ['失效大纲', { outline: { ...snapshot().outline!, stale: true } }],
  ])('%s 时不提供正文上游', (_label, overrides) => {
    const context: StageContext = contextFor(snapshot(overrides));
    expect(context.outline).toBeUndefined();
  });
});
