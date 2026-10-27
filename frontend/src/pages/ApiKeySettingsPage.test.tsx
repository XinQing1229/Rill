import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeySettingsPage } from './ApiKeySettingsPage';
import { get, post } from '../api/client';

vi.mock('../api/client', () => ({ get: vi.fn(), post: vi.fn(), pingLlm: vi.fn() }));

const state = {
  activeProvider: 'deepseek' as const,
  activeModel: 'deepseek-flash',
  providers: {
    deepseek: { model: 'deepseek-flash', hasUserKey: true, keySource: 'user' as const },
    glm: { model: 'glm-5.3', hasUserKey: false, keySource: 'none' as const },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(get).mockResolvedValue(state);
});

describe('模型设置页', () => {
  it('分别展示服务商状态，保存用户 Key 后清空输入且不自动调用模型', async () => {
    vi.mocked(post).mockResolvedValue(state);
    render(<ApiKeySettingsPage />);
    await userEvent.click(await screen.findByText('Deepseek-V4.1-Flash'));
    const input = await screen.findByLabelText('更换 DeepSeek API Key');
    expect(screen.getByText('未配置')).toBeInTheDocument();
    await userEvent.type(input, 'sk-new-key');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('DeepSeek API Key 已保存');
    expect(input).toHaveValue('');
    expect(post).toHaveBeenCalledExactlyOnceWith('/api/llm/settings', {
      action: 'replace-key',
      provider: 'deepseek',
      apiKey: 'sk-new-key',
    });
  });

  it('保存失败保留输入并显示错误', async () => {
    vi.mocked(post).mockRejectedValue(new Error('写入失败'));
    render(<ApiKeySettingsPage />);
    await userEvent.click(await screen.findByText('Deepseek-V4.1-Flash'));
    const input = await screen.findByLabelText('更换 DeepSeek API Key');
    await userEvent.type(input, 'sk-retry');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText(/保存失败，输入已保留/);
    expect(input).toHaveValue('sk-retry');
  });

  it('清除用户 Key 需确认', async () => {
    vi.mocked(post).mockResolvedValue({
      ...state,
      providers: {
        ...state.providers,
        deepseek: { ...state.providers.deepseek, hasUserKey: false, keySource: 'none' },
      },
    });
    render(<ApiKeySettingsPage />);
    await userEvent.click(await screen.findByText('Deepseek-V4.1-Flash'));
    await userEvent.click(await screen.findByRole('button', { name: /^清除$/ }));
    expect(post).not.toHaveBeenCalled();
    await screen.findByText('清除 DeepSeek 用户 Key？');
    const confirmButton = document.querySelector<HTMLButtonElement>(
      '.ant-popover .ant-btn-primary',
    );
    expect(confirmButton).not.toBeNull();
    await userEvent.click(confirmButton!);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/llm/settings', {
        action: 'remove-key',
        provider: 'deepseek',
      }),
    );
  });

  it('切换当前模型后保存 provider 和 model', async () => {
    vi.mocked(post).mockResolvedValue({ ...state, activeProvider: 'glm', activeModel: 'glm-5.3' });
    render(<ApiKeySettingsPage />);
    await userEvent.click(await screen.findByRole('radio', { name: /GLM-5.3/ }));
    await screen.findByText('已切换到 智谱 GLM');
    expect(post).toHaveBeenCalledWith('/api/llm/settings', {
      action: 'select-model',
      provider: 'glm',
      model: 'glm-5.3',
    });
  });
});
