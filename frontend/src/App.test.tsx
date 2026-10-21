import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    // 测试环境无后端：让 fetch 稳定失败，验证错误态渲染
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('测试环境无后端')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('渲染应用外壳与两个功能卡片', async () => {
    render(<App />);
    expect(screen.getByText('Rill · 小说创作 Agent')).toBeInTheDocument();
    expect(screen.getByText('后端健康检查')).toBeInTheDocument();
    expect(screen.getByText('LLM 连通性验证')).toBeInTheDocument();
    // 等待健康检查结果落定，避免异步状态更新未在 act 中完成
    await screen.findByText(/服务正常|后端连接失败/);
  });

  it('后端不可用时展示可读错误', async () => {
    render(<App />);
    expect(await screen.findByText(/后端连接失败/)).toBeInTheDocument();
  });
});
