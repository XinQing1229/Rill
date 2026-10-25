import {
  ConfirmProseBodySchema,
  OverrideProseReviewBodySchema,
  ProseReviewOutputSchema,
  ProseFailedReviewSchema,
  ProseReviewReportSchema,
  ProseSummaryOutputSchema,
  ProseSummaryGenerationSchema,
  PROSE_SUMMARY_GENERATION_LIMITS,
  proseVerdictFor,
  type ProseIssue,
} from '@rill/shared';

const scores = {
  consistency: 80,
  character: 80,
  pacing: 80,
  continuity: 80,
  foreshadow: 80,
  hook: 80,
  aesthetic: 80,
};
function issue(severity: ProseIssue['severity']): ProseIssue {
  return {
    dimension: 'consistency',
    severity,
    problem: '人物能力矛盾',
    evidence: ['他忽然飞了起来'],
    location: '第三段',
    basis: '世界规则禁止飞行',
    suggestion: '改为攀爬',
  };
}

describe('正文共享契约', () => {
  const summary = {
    events: ['林舟隐藏实力失败，被安排次日加试'],
    characterChanges: [],
    foreshadowing: [],
    continuity: '次日加试待承接。',
  };
  it('新摘要允许少量事件与空变化列表，连贯性说明不增加长度限制', () => {
    const data = { ...summary, continuity: '衔接说明。'.repeat(200) };
    expect(ProseSummaryGenerationSchema.parse(data)).toEqual(data);
    expect(ProseSummaryGenerationSchema.safeParse({ ...summary, events: [] }).success).toBe(false);
    expect(ProseSummaryGenerationSchema.safeParse({ ...summary, events: ['  '] }).success).toBe(
      false,
    );
  });
  it.each(['events', 'characterChanges', 'foreshadowing'] as const)(
    '新摘要限制 %s 数量和单条长度，历史摘要保持兼容',
    (key) => {
      const { maxItems, maxCharacters } = PROSE_SUMMARY_GENERATION_LIMITS[key];
      const boundary = { ...summary, [key]: Array(maxItems).fill('字'.repeat(maxCharacters)) };
      expect(ProseSummaryGenerationSchema.safeParse(boundary).success).toBe(true);
      for (const value of [Array(maxItems + 1).fill('内容'), ['字'.repeat(maxCharacters + 1)]]) {
        const data = { ...summary, [key]: value };
        expect(ProseSummaryGenerationSchema.safeParse(data).success).toBe(false);
        expect(ProseSummaryOutputSchema.parse(data)).toEqual(data);
      }
    },
  );
  it('引用要求非空数组，逐字保留空白，拒绝单字符串和空片段', () => {
    const data = {
      scores,
      issues: [{ ...issue('warning'), evidence: ['  原文\n片段  ', '另一段……'] }],
    };
    expect(ProseReviewOutputSchema.parse(data).issues[0].evidence).toEqual(data.issues[0].evidence);
    for (const evidence of ['旧字符串', [], [''], ['  \n '], ['有效', ' ']]) {
      expect(
        ProseReviewOutputSchema.safeParse({ scores, issues: [{ ...issue('warning'), evidence }] })
          .success,
      ).toBe(false);
    }
    for (const previousEvidence of [
      { chapterNumber: 1, quote: '旧字符串' },
      { chapterNumber: 1, quotes: [] },
      { chapterNumber: 1, quotes: [' '] },
    ]) {
      expect(
        ProseReviewOutputSchema.safeParse({
          scores,
          issues: [{ ...issue('warning'), previousEvidence }],
        }).success,
      ).toBe(false);
    }
  });
  it('失败诊断允许无结果和结构异常对象，拒绝缺失字段及非法版本关联', () => {
    const diagnostic = {
      formatVersion: 1,
      status: 'failed',
      reviewId: 'review',
      chapterNumber: 1,
      sourceHash: 'a'.repeat(64),
      dependencyFingerprint: 'b'.repeat(64),
      promptVersion: 'v1',
      failedAt: '2026-10-22T15:00:00.000Z',
      error: '证据校验失败',
      output: null,
    };
    expect(ProseFailedReviewSchema.parse(diagnostic).output).toBeNull();
    const output = { unexpected: '结构不合法的模型结果' };
    expect(ProseFailedReviewSchema.parse({ ...diagnostic, output }).output).toEqual(output);
    for (const invalid of [
      { output: undefined },
      { chapterNumber: 0 },
      { sourceHash: 'mtime' },
      { dependencyFingerprint: 'old' },
      { failedAt: 'yesterday' },
      { status: 'done' },
      { formatVersion: 2 },
    ]) {
      expect(ProseFailedReviewSchema.safeParse({ ...diagnostic, ...invalid }).success).toBe(false);
    }
    expect(ProseReviewReportSchema.safeParse(diagnostic).success).toBe(false);
  });
  it('结论只由问题严重度决定，而非评分', () => {
    expect(proseVerdictFor([])).toBe('accept');
    expect(proseVerdictFor([issue('warning')])).toBe('accept');
    expect(proseVerdictFor([issue('error')])).toBe('polish');
    expect(proseVerdictFor([issue('error'), issue('critical')])).toBe('rewrite');
    expect(
      ProseReviewReportSchema.safeParse({
        id: 'review',
        sourceHash: 'a'.repeat(64),
        dependencyFingerprint: 'b'.repeat(64),
        promptVersion: 'v1',
        coveredChapters: [],
        scores,
        issues: [issue('critical')],
        verdict: 'accept',
        overrideReason: null,
      }).success,
    ).toBe(false);
  });

  it('拒绝缺失维度、越界评分和没有原文证据的问题', () => {
    expect(
      ProseReviewOutputSchema.safeParse({ scores: { ...scores, hook: undefined }, issues: [] })
        .success,
    ).toBe(false);
    expect(
      ProseReviewOutputSchema.safeParse({ scores: { ...scores, hook: 101 }, issues: [] }).success,
    ).toBe(false);
    expect(
      ProseReviewOutputSchema.safeParse({ scores, issues: [{ ...issue('error'), evidence: '  ' }] })
        .success,
    ).toBe(false);
    expect(ProseReviewOutputSchema.safeParse({ scores, issues: [] }).success).toBe(true);
  });

  it('最终接受必须指定机器结果及文件版本，覆盖理由不得为空', () => {
    const version = { expectedRevision: 0, expectedHash: 'a'.repeat(64) };
    expect(ConfirmProseBodySchema.safeParse(version).success).toBe(false);
    expect(
      ConfirmProseBodySchema.safeParse({ ...version, reviewId: 'review', summaryId: 'summary' })
        .success,
    ).toBe(true);
    expect(
      ConfirmProseBodySchema.safeParse({
        ...version,
        expectedHash: 'mtime',
        reviewId: 'review',
        summaryId: 'summary',
      }).success,
    ).toBe(false);
    expect(
      OverrideProseReviewBodySchema.safeParse({ ...version, reviewId: 'review', reason: '  ' })
        .success,
    ).toBe(false);
    expect(
      OverrideProseReviewBodySchema.parse({
        ...version,
        reviewId: 'review',
        reason: ' 作者有意保留 ',
      }).reason,
    ).toBe('作者有意保留');
  });
});
