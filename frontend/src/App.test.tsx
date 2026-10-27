import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { makeProject, makeWorldRow } from './test/fixtures';
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

  it('诊断页移除后显示兜底页', () => {
    render(
      <MemoryRouter initialEntries={['/health']}>
        <AntApp>
          <App />
        </AntApp>
      </MemoryRouter>,
    );
    expect(screen.getByText('页面不存在')).toBeInTheDocument();
    expect(screen.queryByText('诊断')).not.toBeInTheDocument();
  });
});

it('阶段导航展示中文和真实状态，并支持空格键切换', async () => {
  const project = makeProject({ currentStage: 'world', world: makeWorldRow() });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const data = input === `/api/novel/projects/${project.id}` ? project : [];
      return { ok: true, json: async () => data };
    }),
  );
  try {
    render(
      <MemoryRouter initialEntries={[`/projects/${project.id}`]}>
        <AntApp>
          <App />
        </AntApp>
      </MemoryRouter>,
    );
    const world = await screen.findByRole('button', { name: /世界观.*已完成/ });
    expect(world).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByText('world')).not.toBeInTheDocument();
    const characters = screen.getByRole('button', { name: /人物.*待生成/ });
    characters.focus();
    await userEvent.keyboard(' ');
    expect(characters).toHaveAttribute('aria-current', 'true');
    expect(world).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /导出书本/ })).toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([
  ['项目', '项目'],
  ['新建项目', '选择小说类型'],
])('离开工作台进入%s后保留基础导航并隐藏后续阶段', async (link, heading) => {
  const project = makeProject({ currentStage: 'world', world: makeWorldRow() });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => ({
      ok: true,
      json: async () => (input === `/api/novel/projects/${project.id}` ? project : []),
    })),
  );
  try {
    render(
      <MemoryRouter initialEntries={[`/projects/${project.id}`]}>
        <AntApp>
          <App />
        </AntApp>
      </MemoryRouter>,
    );
    const sidebar = within(screen.getByRole('complementary'));
    expect(await sidebar.findByText('后续阶段')).toBeInTheDocument();
    await userEvent.click(
      within(sidebar.getByRole('navigation', { name: '主导航' })).getByRole('link', {
        name: new RegExp(`^${link}`),
      }),
    );
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(sidebar.getByText('创作', { exact: true })).toBeInTheDocument();
    expect(sidebar.getByRole('link', { name: '新建项目' })).toBeInTheDocument();
    expect(sidebar.getByRole('link', { name: '模型设置' })).toBeInTheDocument();
    expect(sidebar.queryByText('后续阶段')).not.toBeInTheDocument();
    expect(sidebar.queryByRole('button', { name: '导出书本' })).not.toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});
