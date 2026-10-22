import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App as AntApp } from 'antd';
import App from './App';

describe('App 路由', () => {
  beforeEach(() => {
    // 测试环境无后端：让 fetch 稳定失败，验证错误态渲染
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('测试环境无后端')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('项目列表路由渲染外壳与页面', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AntApp>
          <App />
        </AntApp>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '项目' })).toBeInTheDocument();
    expect(await screen.findByText('项目列表加载失败')).toBeInTheDocument();
  });

  it('未知路径有兜底页', () => {
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <AntApp>
          <App />
        </AntApp>
      </MemoryRouter>,
    );
    expect(screen.getByText('页面不存在')).toBeInTheDocument();
  });

  it('诊断路由渲染健康检查卡片', async () => {
    render(
      <MemoryRouter initialEntries={['/health']}>
        <AntApp>
          <App />
        </AntApp>
      </MemoryRouter>,
    );
    expect(screen.getByText('后端健康检查')).toBeInTheDocument();
    expect(screen.getByText('LLM 连通性验证')).toBeInTheDocument();
    await screen.findByText(/服务正常|后端连接失败/);
  });
});
