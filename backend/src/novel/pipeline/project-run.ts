import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';

/** 流水线与种子修改共用的数据库执行权，避免跨请求并发。 */
export async function acquireProjectRun(
  db: Pick<Prisma.TransactionClient, 'project'>,
  project: { id: string; updatedAt: Date },
): Promise<string> {
  const runId = randomUUID();
  const result = await db.project.updateMany({
    where: {
      id: project.id,
      deletedAt: null,
      updatedAt: project.updatedAt,
      status: { not: 'running' },
      runId: null,
    },
    data: { status: 'running', runId },
  });
  if (result.count !== 1) throw new ConflictException('项目正在运行或已变更，请刷新后重试');
  return runId;
}
