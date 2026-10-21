import type { HealthResponse, PingResponse } from '@rill/shared';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `请求失败: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health');
}

export function pingLlm(): Promise<PingResponse> {
  return request<PingResponse>('/api/llm/ping', { method: 'POST' });
}
