import {
  CoverHistoryPageSchema,
  ProjectCoverStateSchema,
  type ProjectCoverState,
} from '@rill/shared';
import { ApiError, get } from './client';
const base = (id: string) => `/api/novel/projects/${encodeURIComponent(id)}/cover`;
export const coverImageUrl = (id: string, assetId: string, thumbnail = false) =>
  `${base(id)}/assets/${encodeURIComponent(assetId)}/image?variant=${thumbnail ? 'thumbnail' : 'full'}`;
export const getCover = async (id: string) => ProjectCoverStateSchema.parse(await get(base(id)));
export const getCoverHistory = async (id: string, page = 1) =>
  CoverHistoryPageSchema.parse(await get(`${base(id)}/assets?page=${page}`));
async function stateRequest(
  id: string,
  path: string,
  options: RequestInit,
): Promise<ProjectCoverState> {
  const response = await fetch(base(id) + path, options);
  const body: unknown = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, (body as { message?: string }).message ?? '封面操作失败');
  return ProjectCoverStateSchema.parse(body);
}
const jsonStateRequest = (id: string, path: string, method: 'PATCH' | 'DELETE', payload: unknown) =>
  stateRequest(id, path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
export function uploadCover(id: string, file: File, expectedRevision: number) {
  const body = new FormData();
  body.append('file', file);
  body.append('expectedRevision', String(expectedRevision));
  return stateRequest(id, '/assets', { method: 'POST', body });
}
export const activateCover = (id: string, assetId: string, expectedRevision: number) =>
  jsonStateRequest(id, '/current', 'PATCH', { assetId, expectedRevision });
export const deleteCover = (id: string, assetId: string, expectedRevision: number) =>
  jsonStateRequest(id, '/current', 'DELETE', { assetId, expectedRevision });
export async function downloadCover(id: string, assetId: string) {
  const response = await fetch(`${base(id)}/assets/${encodeURIComponent(assetId)}/download`);
  if (!response.ok) throw new Error('封面下载失败，请刷新后重试');
  if (!/^image\/(png|jpeg)/.test(response.headers.get('content-type') ?? ''))
    throw new Error('封面响应格式错误');
  const url = URL.createObjectURL(await response.blob());
  try {
    const a = document.createElement('a');
    a.href = url;
    const name = response.headers
      .get('content-disposition')
      ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    a.download = name ? decodeURIComponent(name) : 'cover.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
