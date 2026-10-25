import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterCopy } from './ChapterCopy';
import { copyBookChapter } from '../../api/book-export';
vi.mock('../../api/book-export', () => ({ copyBookChapter: vi.fn() }));
const writeText = vi.fn();
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  vi.mocked(copyBookChapter).mockResolvedValue({
    text: '第一章\n\n正文',
    sourceHash: 'a'.repeat(64),
    checkedAt: new Date().toISOString(),
  });
  writeText.mockResolvedValue(undefined);
});
describe('章节复制', () => {
  it('仅在后端核验并成功写剪贴板后显示成功', async () => {
    render(<ChapterCopy projectId="p" chapterNumber={1} />);
    fireEvent.click(screen.getByRole('button', { name: '复制本章' }));
    await screen.findByText('已复制');
    expect(copyBookChapter).toHaveBeenCalledWith('p', 1, 'plain-with-title');
    expect(writeText).toHaveBeenCalledWith('第一章\n\n正文');
  });
  it('无剪贴板权限时提供本次内容手动复制', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<ChapterCopy projectId="p" chapterNumber={2} />);
    fireEvent.click(screen.getByRole('button', { name: '复制本章' }));
    expect(await screen.findByRole('textbox', { name: '可手动复制的正文' })).toHaveValue(
      '第一章\n\n正文',
    );
    expect(screen.queryByText('已复制')).not.toBeInTheDocument();
  });
  it('服务端拒绝时不复制缓存', async () => {
    vi.mocked(copyBookChapter).mockRejectedValue(new Error('前文需重新接受'));
    render(<ChapterCopy projectId="p" chapterNumber={2} />);
    fireEvent.click(screen.getByRole('button', { name: '复制本章' }));
    await screen.findByText('前文需重新接受');
    expect(writeText).not.toHaveBeenCalled();
  });
  it.each(['plain-body', 'markdown-source'] as const)(
    '恢复模式 %s 且在两个入口同步',
    async (mode) => {
      localStorage.setItem('rill.book-copy-mode', mode);
      render(
        <>
          <ChapterCopy projectId="p" chapterNumber={1} />
          <ChapterCopy projectId="p" chapterNumber={2} />
        </>,
      );
      fireEvent.click(screen.getAllByRole('button', { name: '复制本章' })[1]);
      await waitFor(() => expect(copyBookChapter).toHaveBeenCalledWith('p', 2, mode));
    },
  );
});
