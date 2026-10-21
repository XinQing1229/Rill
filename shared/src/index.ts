import { z } from 'zod';

/**
 * Rill 前后端共享的 API 契约类型与结构定义。
 * 领域模型（大纲、章节、人物）随首个真实功能加入。
 */

/** GET /api/health 响应 */
export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

/** POST /api/llm/ping 响应 */
export interface PingResponse {
  ok: boolean;
  model: string;
  content: string;
}

/**
 * 中性的结构化输出验证 schema（非小说领域结构）——
 * 仅用于验证 AI 基建的结构化输出链路，领域 schema 留给后续 change。
 */
export const SampleBookSchema = z.object({
  title: z.string().describe('书名'),
  summary: z.string().describe('一句话简介'),
  tags: z.array(z.string()).describe('标签'),
});

export type SampleBook = z.infer<typeof SampleBookSchema>;
