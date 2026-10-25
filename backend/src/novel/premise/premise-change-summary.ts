import {
  PREMISE_CHANGE_PATHS,
  PremiseChangeSummarySchema,
  type Premise,
  type GeneratedPremise,
  type PremiseChangePath,
  type PremiseChangeSummary,
  type RevisedPremiseOutput,
} from '@rill/shared';

type Value = string | string[] | null;
function valueAt(premise: Premise, path: PremiseChangePath): Value {
  let value: unknown = premise;
  for (const key of path.split('.')) {
    if (value === undefined || value === null) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value === undefined ? null : (value as Value);
}

/** 事实来自结构化值比较，模型只提供辅助说明；漏报和虚报不改变清单。 */
export function buildPremiseChangeSummary(
  original: Premise,
  candidate: GeneratedPremise,
  notes: RevisedPremiseOutput['changeNotes'],
): PremiseChangeSummary {
  const descriptions = new Map<PremiseChangePath, string>();
  for (const note of notes) {
    const description = note.description.trim();
    if (description && !descriptions.has(note.path)) descriptions.set(note.path, description);
  }
  const changes: PremiseChangeSummary['changes'] = [];
  for (const path of PREMISE_CHANGE_PATHS) {
    const before = valueAt(original, path);
    const after = valueAt(candidate, path);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const description = descriptions.get(path);
    changes.push({
      path,
      before,
      after,
      description: description ?? '已调整此处内容，可展开查看修改前后',
      descriptionSource: description ? 'ai' : 'fallback',
    });
  }
  return PremiseChangeSummarySchema.parse({ version: 1, changes });
}

/** 历史记录为空；损坏的摘要降级提示，不影响合法候选的查看与采用。 */
export function readPremiseChangeSummary(data: string | null): {
  changeSummary: PremiseChangeSummary | null;
  changeSummaryWarning?: string;
} {
  if (data === null) return { changeSummary: null };
  try {
    return { changeSummary: PremiseChangeSummarySchema.parse(JSON.parse(data)) };
  } catch {
    return {
      changeSummary: null,
      changeSummaryWarning: '修改摘要暂不可用，仍可查看完整候选并决定是否采用。',
    };
  }
}
