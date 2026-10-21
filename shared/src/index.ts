/**
 * Rill 前后端共享的 API 契约类型。
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
