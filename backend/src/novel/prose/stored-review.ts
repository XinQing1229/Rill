function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 仅用于历史数据库报告读取，不放宽新模型输出，也不写回历史数据。 */
export function normalizeStoredReview(value: unknown): unknown {
  if (!record(value) || !Array.isArray(value.issues)) return value;
  return {
    ...value,
    issues: value.issues.map((issue: unknown) => {
      if (!record(issue)) return issue;
      const previous = issue.previousEvidence;
      return {
        ...issue,
        evidence: typeof issue.evidence === 'string' ? [issue.evidence] : issue.evidence,
        ...(record(previous) && previous.quotes === undefined && typeof previous.quote === 'string'
          ? {
              previousEvidence: { chapterNumber: previous.chapterNumber, quotes: [previous.quote] },
            }
          : {}),
      };
    }),
  };
}

export function hasLegacyEvidence(value: unknown): boolean {
  return (
    record(value) &&
    Array.isArray(value.issues) &&
    value.issues.some(
      (issue: unknown) =>
        record(issue) &&
        (typeof issue.evidence === 'string' ||
          (record(issue.previousEvidence) && typeof issue.previousEvidence.quote === 'string')),
    )
  );
}
