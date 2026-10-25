import { ProseRevisionDetailSchema } from '@rill/shared';
import type { ProseRevision } from '../../../generated/prisma/client.js';

/** 用原文和结果求段落差异；大输入退化为一个变化块，避免平方内存。 */
export function buildProseChanges(before: string, after: string) {
  const a = before.replace(/\r\n?/g, '\n').split('\n\n');
  const b = after.replace(/\r\n?/g, '\n').split('\n\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if (start === endA && start === endB) return [];
  const x = a.slice(start, endA),
    y = b.slice(start, endB);
  if (x.length * y.length > 250000) return [{ before: x.join('\n\n'), after: y.join('\n\n') }];
  const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      table[i][j] =
        x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const changes: { before: string; after: string }[] = [];
  let i = 0,
    j = 0,
    removed: string[] = [],
    added: string[] = [];
  const flush = () => {
    if (removed.length || added.length)
      changes.push({ before: removed.join('\n\n'), after: added.join('\n\n') });
    removed = [];
    added = [];
  };
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      flush();
      i++;
      j++;
    } else if (i < x.length && (j === y.length || table[i + 1][j] >= table[i][j + 1]))
      removed.push(x[i++]);
    else added.push(y[j++]);
  }
  flush();
  return changes;
}
export function revisionDetail(row: ProseRevision) {
  return ProseRevisionDetailSchema.parse({
    ...row,
    suggestions: JSON.parse(row.suggestionsData),
    suggestionResponses: JSON.parse(row.responsesData),
    changes: JSON.parse(row.changesData),
  });
}
