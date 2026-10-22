/** 带 HTTP 状态码的 API 错误（前端据此区分 409 生成中 / 400 校验失败等） */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 统一的 API 请求封装 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? `请求失败: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

import type { HealthResponse, PingResponse } from '@rill/shared';

export function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

/** GET /api/health（诊断页） */
export function getHealth(): Promise<HealthResponse> {
  return get('/api/health');
}

/** POST /api/llm/ping（诊断页） */
export function pingLlm(): Promise<PingResponse> {
  return post('/api/llm/ping');
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
