import {
  BookCopyResponseSchema,
  BookJobListSchema,
  BookJobSchema,
  BookPreviewSchema,
  BookSettingsSchema,
  type BookCopyMode,
  type BookFormat,
  type BookSettings,
} from '@rill/shared';
import { get, patch, post, del, ApiError } from './client';
const base = (id: string) => `/api/novel/projects/${encodeURIComponent(id)}/book-export`;
export const getBookSettings = async (id: string) =>
  BookSettingsSchema.parse(await get(base(id) + '/settings'));
export const saveBookSettings = async (id: string, value: BookSettings) =>
  BookSettingsSchema.parse(
    await patch(base(id) + '/settings', { ...value, expectedRevision: value.revision }),
  );
export const previewBook = async (id: string, chapterNumber = 1, previewToken?: string) =>
  BookPreviewSchema.parse(await post(base(id) + '/preview', { chapterNumber, previewToken }));
export const copyBookChapter = async (id: string, number: number, mode: BookCopyMode) =>
  BookCopyResponseSchema.parse(await post(base(id) + `/chapters/${number}/copy`, { mode }));
export const listBookJobs = async (id: string, page = 1) =>
  BookJobListSchema.parse(await get(base(id) + `/jobs?page=${page}`));
export const createBookJob = async (
  id: string,
  previewToken: string,
  formats: BookFormat[],
  requestId: string,
) => BookJobSchema.parse(await post(base(id) + '/jobs', { previewToken, formats, requestId }));
export const retryBookJob = async (id: string, jobId: string, formats: BookFormat[]) =>
  BookJobSchema.parse(
    await post(base(id) + `/jobs/${encodeURIComponent(jobId)}/retry`, { formats }),
  );
export const deleteBookJob = (id: string, jobId: string) =>
  del(base(id) + `/jobs/${encodeURIComponent(jobId)}`);
export async function downloadBook(id: string, jobId: string, format: BookFormat) {
  const response = await fetch(base(id) + `/jobs/${encodeURIComponent(jobId)}/files/${format}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? '下载失败');
  }
  const expected = { txt: 'text/plain', markdown: 'text/markdown', epub: 'application/epub+zip' }[
    format
  ];
  if (!response.headers.get('content-type')?.startsWith(expected))
    throw new Error('文件响应格式错误');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    const encoded = response.headers
      .get('content-disposition')
      ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    link.download = encoded
      ? decodeURIComponent(encoded)
      : `book.${format === 'markdown' ? 'md' : format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
