import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverAsset } from '@rill/shared';
import * as api from '../../api/cover';
import { CoverWorkbench } from './CoverWorkbench';
import { ApiError } from '../../api/client';
vi.mock('../../api/cover', () => ({
  getCover: vi.fn(),
  getCoverHistory: vi.fn(),
  uploadCover: vi.fn(),
  activateCover: vi.fn(),
  deleteCover: vi.fn(),
  downloadCover: vi.fn(),
  coverImageUrl: (id: string, assetId: string) => `/cover/${id}/${assetId}`,
}));
const asset: CoverAsset = {
  id: 'a',
  mimeType: 'image/png',
  sourceFormat: 'png',
  width: 1200,
  height: 1600,
  size: 4000,
  originalFilename: 'cover.png',
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-27T12:00:00.000Z',
  fileStatus: 'available',
};
const onChanged = vi.fn().mockResolvedValue(null);
function show() {
  return render(
    <App>
      <CoverWorkbench projectId="p" onChanged={onChanged} />
    </App>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getCover).mockResolvedValue({ revision: 0, currentCover: null });
  vi.mocked(api.getCoverHistory).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }),
  );
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1600);
});
describe('封面管理', () => {
  it('无封面时展示上传规格与空历史，当前图操作禁用', async () => {
    show();
    await screen.findByText('尚未设置封面');
    expect(screen.getByText('支持格式：JPG、PNG、WebP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下载封面/ })).toBeDisabled();
    expect(screen.getByText('暂无封面历史，上传封面后将在这里保留记录')).toBeInTheDocument();
  });
  it('选择图片先预览，显式保存后才调用上传并刷新项目', async () => {
    vi.mocked(api.uploadCover).mockResolvedValue({ revision: 1, currentCover: asset });
    show();
    await screen.findByText('尚未设置封面');
    await act(async () =>
      fireEvent.change(screen.getByLabelText('选择封面图片'), {
        target: { files: [new File(['image'], 'cover.png', { type: 'image/png' })] },
      }),
    );
    await screen.findByRole('button', { name: '保存并使用' });
    expect(api.uploadCover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存并使用' }));
    await waitFor(() => expect(api.uploadCover).toHaveBeenCalledWith('p', expect.any(File), 0));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
  it('历史先查看详情，再显式切换，不新增上传', async () => {
    vi.mocked(api.getCoverHistory).mockResolvedValue({
      items: [{ ...asset, isCurrent: false }],
      total: 1,
      page: 1,
      pageSize: 12,
    });
    vi.mocked(api.activateCover).mockResolvedValue({ revision: 1, currentCover: asset });
    show();
    fireEvent.click(await screen.findByRole('button', { name: '查看封面 cover.png' }));
    expect(api.activateCover).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: '设为当前封面' }));
    await waitFor(() => expect(api.activateCover).toHaveBeenCalledWith('p', 'a', 0));
    expect(api.uploadCover).not.toHaveBeenCalled();
  });
  it('保存冲突保留待保存图片并刷新当前版本', async () => {
    vi.mocked(api.uploadCover).mockRejectedValue(new ApiError(409, '封面已变化，请核对'));
    show();
    await screen.findByText('尚未设置封面');
    await act(async () =>
      fireEvent.change(screen.getByLabelText('选择封面图片'), {
        target: { files: [new File(['image'], 'cover.png', { type: 'image/png' })] },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: '保存并使用' }));
    await waitFor(() => expect(api.getCover).toHaveBeenCalledTimes(2));
    expect(screen.getByAltText('待保存封面')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByText('封面已变化，请核对').length).toBeGreaterThan(0),
    );
  });
  it('历史加载失败时仍可上传并单独重试历史', async () => {
    vi.mocked(api.getCoverHistory).mockRejectedValue(new Error('历史暂不可用'));
    show();
    await screen.findByText('历史暂不可用');
    expect(screen.getByRole('button', { name: /上传新封面/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(api.getCoverHistory).toHaveBeenCalledTimes(2));
  });
  it('下载时的附件链接不会被离开页面保护误拦截', async () => {
    vi.mocked(api.getCover).mockResolvedValue({ revision: 1, currentCover: asset });
    let allowed: boolean | undefined;
    vi.mocked(api.downloadCover).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const anchor = document.createElement('a');
      anchor.download = 'cover.png';
      document.body.appendChild(anchor);
      allowed = anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      anchor.remove();
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /下载封面/ }));
    await waitFor(() => expect(allowed).toBe(true));
  });
});
