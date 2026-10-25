import type { Prisma } from '../../../generated/prisma/client.js';
import {
  OutlinePlanSchema,
  ChapterBatchSchema,
  type ArtifactStatus,
  type Stage,
  type StageContext,
} from '@rill/shared';

type Row = { status: string; stale: boolean; data?: string };
export interface StageSnapshot {
  proseBook?: {
    targetChapters: number;
    chapters: Array<{
      confirmedHash: string | null;
      observedHash: string | null;
      reviewStatus: string;
      stale: boolean;
    }>;
  } | null;
  premise?: Row | null;
  world?: Row | null;
  characters?: Row[];
  relations?: Array<
    Row & {
      fromId?: string;
      toId?: string;
      type?: string;
      fromRole?: string;
      toRole?: string;
      description?: string;
    }
  >;
  outline?: {
    targetChapters?: number;
    stale: boolean;
    revision: number;
    confirmedRevision: number | null;
    planData: string | null;
    batches: Array<{ planRevision: number; status: string; data: string | null }>;
    planRevision: number;
  } | null;
}

/** 项目已进入回收站时，产物写入必须静默失效：删除期间的残留任务不得修改产物数据。 */
const VISIBLE_PROJECT = { project: { deletedAt: null } };

/** 阶段存储适配集中声明，runner 与上游装配无需识别具体产物表。 */
export const STAGE_STORAGE = {
  prose: {
    invalidate: async (tx: Prisma.TransactionClient, id: string, stale: boolean) => {
      if (!stale) return;
      await tx.proseChapter.updateMany({
        where: { book: { projectId: id, project: { deletedAt: null } } },
        data: { stale: true, confirmedHash: null, reviewStatus: 'needs_review' },
      });
    },
    rows: (p: StageSnapshot): Row[] =>
      (p.proseBook?.chapters ?? []).map((c) => ({
        status:
          c.confirmedHash &&
          c.confirmedHash === c.observedHash &&
          c.reviewStatus === 'confirmed' &&
          !c.stale
            ? 'done'
            : 'pending',
        stale: c.stale,
      })),
    write: async (
      _tx: Prisma.TransactionClient,
      _id: string,
      _data: { status: ArtifactStatus; error: string | null },
    ) => {},
  },
  premise: {
    invalidate: (tx: Prisma.TransactionClient, id: string, stale: boolean) =>
      tx.premise.updateMany({ where: { projectId: id, ...VISIBLE_PROJECT }, data: { stale } }),
    rows: (p: StageSnapshot) => (p.premise ? [p.premise] : []),
    write: (
      tx: Prisma.TransactionClient,
      id: string,
      data: { status: ArtifactStatus; error: string | null },
    ) => tx.premise.updateMany({ where: { projectId: id, ...VISIBLE_PROJECT }, data }),
  },
  world: {
    invalidate: (tx: Prisma.TransactionClient, id: string, stale: boolean) =>
      tx.worldSetting.updateMany({ where: { projectId: id, ...VISIBLE_PROJECT }, data: { stale } }),
    rows: (p: StageSnapshot) => (p.world ? [p.world] : []),
    write: (
      tx: Prisma.TransactionClient,
      id: string,
      data: { status: ArtifactStatus; error: string | null },
    ) => tx.worldSetting.updateMany({ where: { projectId: id, ...VISIBLE_PROJECT }, data }),
  },
  characters: {
    invalidate: (tx: Prisma.TransactionClient, id: string, stale: boolean) =>
      tx.character.updateMany({ where: { projectId: id, ...VISIBLE_PROJECT }, data: { stale } }),
    rows: (p: StageSnapshot) => p.characters ?? [],
    write: (
      tx: Prisma.TransactionClient,
      id: string,
      data: { status: ArtifactStatus; error: string | null },
    ) => tx.character.updateMany({ where: { projectId: id, ...VISIBLE_PROJECT }, data }),
  },
  outline: {
    invalidate: (tx: Prisma.TransactionClient, id: string, stale: boolean) =>
      tx.outline.updateMany({
        where: { projectId: id, ...VISIBLE_PROJECT },
        data: stale
          ? { stale: true, confirmedRevision: null, planConfirmedRevision: null }
          : { stale: false },
      }),
    rows: (p: StageSnapshot): Row[] =>
      p.outline
        ? [
            {
              status: p.outline.confirmedRevision === p.outline.revision ? 'done' : 'pending',
              stale: p.outline.stale,
            },
          ]
        : [],
    write: async (
      _tx: Prisma.TransactionClient,
      _id: string,
      _data: { status: ArtifactStatus; error: string | null },
    ) => {},
  },
  relations: {
    invalidate: (tx: Prisma.TransactionClient, id: string, stale: boolean) =>
      tx.relation.updateMany({ where: { projectId: id, ...VISIBLE_PROJECT }, data: { stale } }),
    rows: (p: StageSnapshot) => p.relations ?? [],
    write: (
      tx: Prisma.TransactionClient,
      id: string,
      data: { status: ArtifactStatus; error: string | null },
    ) => tx.relation.updateMany({ where: { projectId: id, ...VISIBLE_PROJECT }, data }),
  },
} satisfies Partial<Record<Stage, unknown>>;

export function storageFor(stage: Stage) {
  return STAGE_STORAGE[stage as keyof typeof STAGE_STORAGE];
}

/** 上游内容映射与状态/存储适配放在同一处。 */
export function contextFor(snapshot: StageSnapshot): StageContext {
  const context: StageContext = {};
  for (const [stage, adapter] of Object.entries(STAGE_STORAGE)) {
    if (stage === 'prose') continue;
    const rows = adapter
      .rows(snapshot)
      .filter((row) => row.status === 'done' && !row.stale && row.data);
    if (!rows.length) continue;
    const content = rows.map((row) => JSON.parse(row.data!));
    Object.assign(context, {
      [stage]: stage === 'characters' || stage === 'relations' ? content : content[0],
    });
  }
  context.characterRefs = (snapshot.characters ?? [])
    .filter((row) => row.status === 'done' && !row.stale)
    .map((row) => {
      const character = row as Row & { id: string; name: string };
      return { id: character.id, name: character.name };
    });
  context.relations = (snapshot.relations ?? [])
    .filter((row) => row.status === 'done' && !row.stale)
    .map((row) => ({
      fromId: row.fromId!,
      toId: row.toId!,
      type: row.type!,
      fromRole: row.fromRole!,
      toRole: row.toRole!,
      description: row.description!,
    }));
  const outline = snapshot.outline;
  if (
    outline &&
    !outline.stale &&
    outline.confirmedRevision === outline.revision &&
    outline.planData
  ) {
    context.outline = {
      plan: OutlinePlanSchema.parse(JSON.parse(outline.planData)),
      chapters: outline.batches
        .filter((b) => b.planRevision === outline.planRevision && b.status === 'done' && b.data)
        .flatMap((b) => ChapterBatchSchema.parse(JSON.parse(b.data!)).chapters)
        .filter(
          (chapter) =>
            outline.targetChapters === undefined || chapter.number <= outline.targetChapters,
        )
        .sort((a, b) => a.number - b.number),
    };
  }
  return context;
}
