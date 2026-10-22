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
