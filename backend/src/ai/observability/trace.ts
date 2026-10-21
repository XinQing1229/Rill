import { randomUUID } from 'node:crypto';

/** 一次生成请求的追踪标识，贯穿日志与用量记录 */
export function newTraceId(): string {
  return randomUUID();
}
