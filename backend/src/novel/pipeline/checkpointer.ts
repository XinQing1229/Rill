import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

/**
 * checkpointer 使用独立于 Prisma 的 SQLite 库文件，
 * 避免与业务库（dev.db）共享文件带来锁竞争。
 */

/** 把 Prisma 风格的 `file:` URL 转为本地路径 */
export function toSqlitePath(url: string): string {
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

/** 创建流水线图的 checkpointer（进程内单例即可，SQLite 连接由底层持有） */
export function createCheckpointer(file: string): SqliteSaver {
  return SqliteSaver.fromConnString(toSqlitePath(file));
}

/**
 * 删除某项目的执行快照。
 * 底层 `deleteThread` 不负责建表（表由 getTuple/put 惰性创建），
 * 全新 checkpoint 库上的首个 force 生成会先走到删除入口，
 * 因此删除前读一次该线程完成初始化，使冷启动的删除幂等安全。
 */
export async function deleteCheckpointThread(saver: SqliteSaver, threadId: string): Promise<void> {
  // getTuple 会惰性建表，deleteThread 本身不建表
  await saver.getTuple({ configurable: { thread_id: threadId } });
  await saver.deleteThread(threadId);
}
