import type { WritingStyleSelection } from '@rill/shared';
import { proseHash } from './prose-files.service.js';
/** 正文接受及交付共用的版本算法；beat 仅保留为历史证据的版本盐，新章节为 0。 */
export function proseDependencyFingerprint(
  outline: number,
  legacyRevision: number,
  previous: unknown[],
  writingStyle?: WritingStyleSelection,
) {
  return proseHash(
    JSON.stringify({
      outline,
      beat: legacyRevision,
      previous,
      ...(writingStyle ? { writingStyle } : {}),
    }),
  );
}
