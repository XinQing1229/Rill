import type { GeneratedPremise } from '@rill/shared';
export const premiseFixture: GeneratedPremise = {
  title: '旧城来信',
  logline: '修复师寻找失踪的父亲',
  theme: '信任',
  coreConflict: '真相与隐瞒',
  storyEngine: {
    openingGoal: '在拆迁前找到信件',
    mainObstacle: '档案被封存',
    failureCost: '线索消失',
    escalationPath: ['证人失踪', '档案即将销毁'],
  },
  protagonist: { name: '林安', identity: '修复师', desire: '找到父亲', flaw: '不信任他人' },
  setting: { era: '现代', place: '旧城', socialBackground: '城市改建' },
  hook: '信件来自未来',
  taboos: ['血腥'],
};
