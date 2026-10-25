import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type { PrismaService } from '../prisma.service.js';
import { deleteCheckpointThread } from './checkpointer.js';

export const PIPELINE_VERSION = 'outline-prose-v1';

/** 旧图包含已删除的节点，启动时放弃执行快照，从业务库中的产物和进度恢复。 */
export async function migratePipeline(prisma: PrismaService, saver: SqliteSaver) {
  const projects = await prisma.project.findMany({
    where: { currentStage: 'beats' },
    select: {
      id: true,
      currentStage: true,
      outline: { select: { stale: true, revision: true, confirmedRevision: true } },
    },
  });
  for (const project of projects) {
    await discardLegacyCheckpoint(saver, project.id);
    const outline = project.outline;
    const ready = outline && !outline.stale && outline.confirmedRevision === outline.revision;
    await prisma.project.updateMany({
      where: { id: project.id, currentStage: 'beats' },
      data: { currentStage: ready ? 'prose' : 'outline', status: 'idle', runId: null },
    });
  }
}

/** LangGraph 不会自动保存调用配置的自定义 metadata，必须在 saver 写入时附加版本。 */
export function versionedCheckpointer(saver: SqliteSaver): SqliteSaver {
  return new Proxy(saver, {
    get(target, property) {
      if (property === 'put')
        return (
          config: Parameters<SqliteSaver['put']>[0],
          checkpoint: Parameters<SqliteSaver['put']>[1],
          metadata: Parameters<SqliteSaver['put']>[2],
        ) =>
          target.put(config, checkpoint, {
            ...metadata,
            rillPipelineVersion: PIPELINE_VERSION,
          } as Parameters<SqliteSaver['put']>[2]);
      const method = Reflect.get(target, property);
      return typeof method === 'function' ? method.bind(target) : method;
    },
  });
}

/** 其他旧项目在取得运行权后按需升级快照，避免启动时扫描全部历史执行记录。 */
export async function discardLegacyCheckpoint(saver: SqliteSaver, id: string) {
  const checkpoint = await saver.getTuple({ configurable: { thread_id: id } });
  if (
    checkpoint &&
    (checkpoint.metadata as Record<string, unknown> | undefined)?.rillPipelineVersion !==
      PIPELINE_VERSION
  )
    await deleteCheckpointThread(saver, id);
}
