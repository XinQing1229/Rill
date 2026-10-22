import type { Prisma } from '../../../generated/prisma/client.js';
import type { ArtifactStatus, Stage, StageContext } from '@rill/shared';

type Row = { status: string; stale: boolean; data?: string };
export interface StageSnapshot {
  premise?: Row | null;
  world?: Row | null;
  characters?: Row[];
  relations?: Row[];
}

/** 阶段存储适配集中声明，runner 与上游装配无需识别具体产物表。 */
export const STAGE_STORAGE = {
  premise: {
    invalidate: (tx: Prisma.TransactionClient, id: string, stale: boolean) =>
      tx.premise.updateMany({ where: { projectId: id }, data: { stale } }),
    rows: (p: StageSnapshot) => (p.premise ? [p.premise] : []),
    write: (
      tx: Prisma.TransactionClient,
      id: string,
      data: { status: ArtifactStatus; error: string | null },
    ) => tx.premise.updateMany({ where: { projectId: id }, data }),
  },
  world: {
    invalidate: (tx: Prisma.TransactionClient, id: string, stale: boolean) =>
      tx.worldSetting.updateMany({ where: { projectId: id }, data: { stale } }),
    rows: (p: StageSnapshot) => (p.world ? [p.world] : []),
    write: (
      tx: Prisma.TransactionClient,
      id: string,
      data: { status: ArtifactStatus; error: string | null },
    ) => tx.worldSetting.updateMany({ where: { projectId: id }, data }),
  },
  characters: {
    invalidate: (tx: Prisma.TransactionClient, id: string, stale: boolean) =>
      tx.character.updateMany({ where: { projectId: id }, data: { stale } }),
    rows: (p: StageSnapshot) => p.characters ?? [],
    write: (
      tx: Prisma.TransactionClient,
      id: string,
      data: { status: ArtifactStatus; error: string | null },
    ) => tx.character.updateMany({ where: { projectId: id }, data }),
  },
  relations: {
    invalidate: (tx: Prisma.TransactionClient, id: string, stale: boolean) =>
      tx.relation.updateMany({ where: { projectId: id }, data: { stale } }),
    rows: (p: StageSnapshot) => p.relations ?? [],
    write: (
      tx: Prisma.TransactionClient,
      id: string,
      data: { status: ArtifactStatus; error: string | null },
    ) => tx.relation.updateMany({ where: { projectId: id }, data }),
  },
} satisfies Partial<Record<Stage, unknown>>;

export function storageFor(stage: Stage) {
  return STAGE_STORAGE[stage as keyof typeof STAGE_STORAGE];
}

/** 上游内容映射与状态/存储适配放在同一处。 */
export function contextFor(snapshot: StageSnapshot): StageContext {
  const context: StageContext = {};
  for (const [stage, adapter] of Object.entries(STAGE_STORAGE)) {
    const rows = adapter
      .rows(snapshot)
      .filter((row) => row.status === 'done' && !row.stale && row.data);
    if (!rows.length) continue;
    const content = rows.map((row) => JSON.parse(row.data!));
    Object.assign(context, {
      [stage]: stage === 'characters' || stage === 'relations' ? content : content[0],
    });
  }
  return context;
}
