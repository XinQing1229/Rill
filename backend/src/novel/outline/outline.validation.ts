import { BadRequestException } from '@nestjs/common';
import {
  ChapterBatchSchema,
  OutlinePlanSchema,
  type ChapterSummary,
  type OutlinePlan,
} from '@rill/shared';

export function validatePlan(plan: OutlinePlan, count: number, ids: string[]): void {
  OutlinePlanSchema.parse(plan);
  const characters = new Set(ids);
  const segments = new Set<string>();
  let next = 1;
  for (const segment of plan.segments) {
    if (segments.has(segment.id) || segment.startChapter !== next || segment.endChapter < next)
      throw new BadRequestException('segments: 章节范围必须连续、唯一且不重叠');
    segments.add(segment.id);
    next = segment.endChapter + 1;
  }
  if (next !== count + 1) throw new BadRequestException('segments: 分段总章数必须等于目标章数');
  for (const arc of plan.characterArcs) {
    if (!characters.has(arc.characterId))
      throw new BadRequestException('characterArcs: 人物引用无效');
  }
  for (const relation of plan.relationDevelopments) {
    if (
      !characters.has(relation.fromId) ||
      !characters.has(relation.toId) ||
      relation.fromId === relation.toId
    )
      throw new BadRequestException('relationDevelopments: 人物引用无效');
  }
}

export function splitBatches(plan: OutlinePlan) {
  return plan.segments.flatMap((segment) => {
    const batches = [];
    for (let start = segment.startChapter; start <= segment.endChapter; start += 10)
      batches.push({
        startChapter: start,
        endChapter: Math.min(start + 9, segment.endChapter),
        segmentId: segment.id,
      });
    return batches;
  });
}

export function validateChapters(
  chapters: ChapterSummary[],
  batch: { startChapter: number; endChapter: number; segmentId: string },
  ids: string[],
) {
  ChapterBatchSchema.parse({ chapters });
  if (chapters.length !== batch.endChapter - batch.startChapter + 1)
    throw new BadRequestException('chapters: 本批章节数量不符');
  const sorted = [...chapters].sort((a, b) => a.number - b.number);
  sorted.forEach((chapter, index) => {
    if (chapter.number !== batch.startChapter + index || chapter.segmentId !== batch.segmentId)
      throw new BadRequestException('chapters: 章号缺失、重复、越界或剧情段归属错误');
    if (chapter.characterIds.some((id) => !ids.includes(id)))
      throw new BadRequestException('chapters.characterIds: 人物引用无效');
  });
}
