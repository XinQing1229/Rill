import {
  PREMISE_CHANGE_PATHS,
  PremiseChangeSummarySchema,
  PremisePreviewSchema,
  RevisedPremiseOutputSchema,
  type Premise,
} from '@rill/shared';
import { premiseFixture as sample } from '../../../test/fixtures/premise.js';
import { buildPremiseChangeSummary, readPremiseChangeSummary } from './premise-change-summary.js';

it('真实变化决定清单，虚报被过滤、漏报被补齐、重复说明保留第一条', () => {
  const candidate = { ...sample, coreConflict: '新的核心冲突', hook: '新的卖点' };
  const summary = buildPremiseChangeSummary(sample, candidate, [
    { path: 'coreConflict', description: '加强冲突' },
    { path: 'coreConflict', description: '重复说明' },
    { path: 'theme', description: '模型虚报的主题修改' },
  ]);
  expect(summary.changes.map((item) => item.path)).toEqual(['coreConflict', 'hook']);
  expect(summary.changes[0]).toMatchObject({
    before: sample.coreConflict,
    after: candidate.coreConflict,
    description: '加强冲突',
    descriptionSource: 'ai',
  });
  expect(summary.changes[1].descriptionSource).toBe('fallback');
});

it('覆盖全部 17 个字段，按固定顺序列出，数组整体计数并识别顺序', () => {
  const candidate = structuredClone(sample);
  for (const path of PREMISE_CHANGE_PATHS) {
    const keys = path.split('.');
    let object: Record<string, unknown> = candidate;
    for (const key of keys.slice(0, -1)) object = object[key] as Record<string, unknown>;
    const key = keys.at(-1)!;
    const old = object[key];
    object[key] = Array.isArray(old) ? [...old].reverse().concat('新增内容') : `${old}变化`;
  }
  expect(buildPremiseChangeSummary(sample, candidate, []).changes.map((c) => c.path)).toEqual([
    ...PREMISE_CHANGE_PATHS,
  ]);
  const reordered = {
    ...sample,
    storyEngine: {
      ...sample.storyEngine,
      escalationPath: [...sample.storyEngine.escalationPath].reverse(),
    },
  };
  expect(buildPremiseChangeSummary(sample, reordered, []).changes).toMatchObject([
    {
      path: 'storyEngine.escalationPath',
      before: sample.storyEngine.escalationPath,
      after: reordered.storyEngine.escalationPath,
    },
  ]);
});

it('历史种子缺发动机以 null 表示，与空字符串和空数组区分；零改动不伪造变化', () => {
  const legacy: Premise = { ...sample, storyEngine: undefined };
  const result = buildPremiseChangeSummary(legacy, sample, []);
  expect(result.changes).toHaveLength(4);
  expect(result.changes.every((c) => c.before === null)).toBe(true);
  expect(
    buildPremiseChangeSummary(sample, sample, [{ path: 'title', description: '虚报' }]).changes,
  ).toEqual([]);
  expect(
    buildPremiseChangeSummary(sample, { ...sample, title: sample.title + ' ' }, []).changes,
  ).toHaveLength(1);
});

it('共享契约限制字段路径、描述、重复项与不变项，旧响应可兼容', () => {
  expect(RevisedPremiseOutputSchema.parse({ premise: sample }).changeNotes).toEqual([]);
  for (const note of [
    { path: 'genre', description: '越界' },
    { path: 'theme', description: ' ' },
    { path: 'theme', description: '字'.repeat(121) },
  ]) {
    expect(
      RevisedPremiseOutputSchema.safeParse({ premise: sample, changeNotes: [note] }).success,
    ).toBe(false);
  }
  const summary = buildPremiseChangeSummary(sample, { ...sample, theme: '新主题' }, []);
  expect(
    PremiseChangeSummarySchema.safeParse({
      ...summary,
      changes: [...summary.changes, ...summary.changes],
    }).success,
  ).toBe(false);
  expect(
    PremiseChangeSummarySchema.safeParse({
      ...summary,
      changes: [{ ...summary.changes[0], after: sample.theme }],
    }).success,
  ).toBe(false);
  expect(
    PremiseChangeSummarySchema.safeParse({
      ...summary,
      changes: [{ ...summary.changes[0], after: [] }],
    }).success,
  ).toBe(false);
  expect(
    PremisePreviewSchema.parse({ candidateId: 'old', premise: sample }).changeSummary,
  ).toBeNull();
});

it('历史摘要为空、损坏摘要明确降级，合法摘要原样读取', () => {
  expect(readPremiseChangeSummary(null)).toEqual({ changeSummary: null });
  expect(readPremiseChangeSummary('{')).toMatchObject({
    changeSummary: null,
    changeSummaryWarning: expect.stringContaining('暂不可用'),
  });
  const summary = buildPremiseChangeSummary(sample, { ...sample, theme: '新主题' }, []);
  expect(readPremiseChangeSummary(JSON.stringify(summary))).toEqual({ changeSummary: summary });
});
