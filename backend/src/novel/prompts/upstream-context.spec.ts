import { renderUpstreamContext } from './upstream-context.js';
import type { Premise, StageContext } from '@rill/shared';

const legacyPremise: Premise = {
  title: '旧案',
  logline: '仵作追查旧案',
  theme: '真相',
  coreConflict: '市井与权贵',
  protagonist: { name: '沈砚', identity: '仵作', desire: '查明真相', flaw: '执拗' },
  setting: { era: '南宋', place: '临安', socialBackground: '市井' },
  hook: '旧案重现',
  taboos: [],
};

describe('renderUpstreamContext', () => {
  it('传递故事发动机与人物弧光给后续阶段', () => {
    const context: StageContext = {
      premise: {
        ...legacyPremise,
        storyEngine: {
          openingGoal: '在三日内找到旧案证人',
          mainObstacle: '官府封锁证人住处',
          failureCost: '证人将被灭口',
          escalationPath: ['证人失踪', '证据被销毁'],
        },
      },
      characters: [
        {
          name: '沈砚',
          role: 'protagonist',
          identity: '仵作',
          desire: '查明真相',
          flaw: '执拗',
          personality: '谨慎',
          background: '旧案受害者之子',
          abilities: '验尸',
          arc: '学会信任同伴',
        },
      ],
    };

    const rendered = renderUpstreamContext(context);
    expect(rendered).toContain('开篇目标：在三日内找到旧案证人');
    expect(rendered).toContain('主要阻力：官府封锁证人住处');
    expect(rendered).toContain('失败代价：证人将被灭口');
    expect(rendered).toContain('证人失踪 → 证据被销毁');
    expect(rendered).toContain('弧光：学会信任同伴');
  });

  it('历史种子缺少故事发动机时不伪造内容', () => {
    const rendered = renderUpstreamContext({ premise: legacyPremise });
    expect(rendered).toContain('【种子设定】');
    expect(rendered).not.toContain('【故事发动机】');
    expect(rendered).not.toContain('开篇目标：');
  });
});
