import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookJob, BookPreview, BookSettings } from '@rill/shared';
import * as api from '../../api/book-export';
import { BookExportWorkbench } from './BookExportWorkbench';
vi.mock('../../api/book-export', () => ({
  getBookSettings: vi.fn(),
  saveBookSettings: vi.fn(),
  previewBook: vi.fn(),
  listBookJobs: vi.fn(),
  createBookJob: vi.fn(),
  retryBookJob: vi.fn(),
  deleteBookJob: vi.fn(),
  downloadBook: vi.fn(),
  copyBookChapter: vi.fn(),
}));
const settings: BookSettings = {
  title: '成书名',
  author: '',
  introduction: '简介',
  chapterTitles: [],
  revision: 1,
  outlineRevision: 1,
  chapters: [{ chapterNumber: 1, title: '信', defaultTitle: '信', needsCheck: false }],
};
const preview: BookPreview = {
  metadata: settings,
  chapters: [{ chapterNumber: 1, title: '信', accepted: true }],
  selected: null,
  diagnostics: [],
  previewToken: 'a'.repeat(64),
  contentFingerprint: 'b'.repeat(64),
};
const job: BookJob = {
  id: 'j',
  title: '旧书名',
  chapterCount: 1,
  status: 'partial_failed',
  error: 'EPUB 生成失败',
  snapshotId: 's',
  contentFingerprint: 'a'.repeat(64),
  versionStatus: 'historical',
  createdAt: new Date().toISOString(),
  files: [
    { format: 'txt', status: 'succeeded', size: 100, error: null },
    { format: 'epub', status: 'failed', size: null, error: '磁盘失败' },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBookSettings).mockResolvedValue(structuredClone(settings));
  vi.mocked(api.listBookJobs).mockResolvedValue({ items: [], total: 0, page: 1 });
  vi.mocked(api.previewBook).mockResolvedValue(structuredClone(preview));
});
describe('导出工作区', () => {
  it('独立显示书籍信息，未预览不可导出，未保存不可预览', async () => {
    render(<BookExportWorkbench projectId="p" />);
    const title = await screen.findByRole('textbox', { name: '书名（必填）' });
    expect(screen.getByRole('button', { name: /生成整书文件/ })).toBeDisabled();
    fireEvent.change(title, { target: { value: '改名' } });
    expect(screen.getByRole('button', { name: '刷新预览与状态' })).toBeDisabled();
    expect(api.saveBookSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '确认并推进' })).not.toBeInTheDocument();
  }, 15000);
  it('保存冲突保留作者输入', async () => {
    vi.mocked(api.saveBookSettings).mockRejectedValue(new Error('成书信息已变化，请刷新核对'));
    render(<BookExportWorkbench projectId="p" />);
    const title = await screen.findByRole('textbox', { name: '书名（必填）' });
    fireEvent.change(title, { target: { value: '保留编辑' } });
    fireEvent.click(screen.getByRole('button', { name: '保存书籍信息' }));
    await screen.findByText('成书信息已变化，请刷新核对');
    expect(title).toHaveValue('保留编辑');
  }, 15000);
  it('预览阻塞显示章节原因并禁止整书提交', async () => {
    vi.mocked(api.previewBook).mockResolvedValue({
      ...preview,
      previewToken: null,
      diagnostics: [
        { code: 'CHAPTER_NOT_ACCEPTED', message: '第 1 章需重新接受', chapterNumber: 1 },
      ],
    });
    render(<BookExportWorkbench projectId="p" />);
    await screen.findByRole('textbox', { name: '书名（必填）' });
    fireEvent.click(screen.getByRole('button', { name: '刷新预览与状态' }));
    await screen.findByText('第 1 章需重新接受');
    expect(screen.getByRole('button', { name: /生成整书文件/ })).toBeDisabled();
  }, 15000);
  it('多格式提交，过期错误可见且保留信息', async () => {
    vi.mocked(api.createBookJob).mockRejectedValue(new Error('预览已过期'));
    render(<BookExportWorkbench projectId="p" />);
    await screen.findByRole('textbox', { name: '书名（必填）' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '刷新预览与状态' }));
    });
    fireEvent.click(screen.getByRole('button', { name: /生成整书文件/ }));
    await screen.findByText('预览已过期');
    expect(api.createBookJob).toHaveBeenCalledWith(
      'p',
      preview.previewToken,
      ['txt', 'markdown', 'epub'],
      expect.any(String),
    );
  }, 15000);
  it('历史可下载成功格式、仅重试失败格式，下载错误不会被当成功', async () => {
    vi.mocked(api.listBookJobs).mockResolvedValue({ items: [job], total: 1, page: 1 });
    vi.mocked(api.downloadBook).mockRejectedValue(new Error('文件缺失'));
    vi.mocked(api.retryBookJob).mockResolvedValue(job);
    render(<BookExportWorkbench projectId="p" />);
    await screen.findByText('旧书名');
    expect(screen.getByText('历史版本')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /下\s*载/ }));
    await screen.findByText('文件缺失');
    fireEvent.click(screen.getByRole('button', { name: /重试.*EPUB/ }));
    await waitFor(() => expect(api.retryBookJob).toHaveBeenCalledWith('p', 'j', ['epub']));
  }, 15000);
});
