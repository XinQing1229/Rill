import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../prisma.service.js';

export const executionContext = new AsyncLocalStorage<{
  projectId: string;
  runId: string;
  signal: AbortSignal;
}>();

/** 检查与写入处于同一事务，旧任务不能在检查后被新任务抢占。 */
export async function commitGeneration(
  prisma: PrismaService,
  write: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  const execution = executionContext.getStore();
  if (!execution) return prisma.$transaction(write);
  execution.signal.throwIfAborted();
  await prisma.$transaction(async (tx) => {
    const owned = await tx.project.updateMany({
      where: { id: execution.projectId, runId: execution.runId, status: 'running' },
      data: { runId: execution.runId },
    });
    if (owned.count !== 1) throw new Error('运行已失效，拒绝提交旧结果');
    execution.signal.throwIfAborted();
    const before = await tx.project.findUniqueOrThrow({ where: { id: execution.projectId } });
    await write(tx);
    const after = await tx.project.findUniqueOrThrow({ where: { id: execution.projectId } });
    await tx.stageRun.updateMany({
      where: { projectId: execution.projectId, runId: execution.runId, stage: after.currentStage },
      data: {
        promptTokens: { increment: after.promptTokens - before.promptTokens },
        completionTokens: { increment: after.completionTokens - before.completionTokens },
      },
    });
  });
}
