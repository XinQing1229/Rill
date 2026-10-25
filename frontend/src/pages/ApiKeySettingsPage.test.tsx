import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeySettingsPage } from './ApiKeySettingsPage';
import { get, post } from '../api/client';
vi.mock('../api/client', () => ({ get: vi.fn(), post: vi.fn() }));
const state = {
  hasApiKey: true,
  baseUrl: 'https://api.deepseek.com',
  draftModel: 'draft',
  reasoningModel: 'reasoning',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(get).mockResolvedValue(state);
});
describe('API Key 设置页', () => {
  it('显示脱敏状态，保存成功清空输入且不自动调用模型', async () => {
    vi.mocked(post).mockResolvedValue(state);
    render(<ApiKeySettingsPage />);
    const input = await screen.findByLabelText('更换 API Key');
    expect(input).toHaveValue('');
    await userEvent.type(input, 'sk-new-key');
    await userEvent.click(screen.getByRole('button', { name: '保存 API Key' }));
    await screen.findByText('API Key 已保存，后续模型调用立即生效。');
    expect(input).toHaveValue('');
    expect(post).toHaveBeenCalledExactlyOnceWith('/api/llm/settings', {
      action: 'replace',
      apiKey: 'sk-new-key',
    });
  });
  it('保存失败保留输入并显示错误', async () => {
    vi.mocked(post).mockRejectedValue(new Error('写入失败'));
    render(<ApiKeySettingsPage />);
    const input = await screen.findByLabelText('更换 API Key');
    await userEvent.type(input, 'sk-retry');
    await userEvent.click(screen.getByRole('button', { name: '保存 API Key' }));
    await screen.findByText(/保存失败，输入已保留/);
    expect(input).toHaveValue('sk-retry');
  });
  it('清除需确认，成功后显示未配置', async () => {
    vi.mocked(post).mockResolvedValue({ ...state, hasApiKey: false });
    render(<ApiKeySettingsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '清除 API Key' }));
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: '清 除' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/llm/settings', { action: 'remove' }),
    );
    expect(await screen.findByText('未配置')).toBeInTheDocument();
  });
});
