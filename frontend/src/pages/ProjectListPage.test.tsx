import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ProjectListPage } from './ProjectListPage';
import { makeSummary } from '../test/fixtures';

vi.mock('../api/novel', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listProjects: vi.fn(),
}));

import { listProjects } from '../api/novel';

const mockList = vi.mocked(listProjects);

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectListPage />
    </MemoryRouter>,
  );
}

describe('ProjectListPage', () => {
  it('空状态给出新建引导', async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument();
  });

  it('展示项目概要与状态', async () => {
    mockList.mockResolvedValue([
      makeSummary({ status: 'idle' }),
      makeSummary({ id: 'p2', title: '雾港来信', genre: 'xuanyi', status: 'running', currentStage: 'world' }),
    ]);
    renderPage();
    expect(await screen.findByText('青川令')).toBeInTheDocument();
    expect(screen.getByText('雾港来信')).toBeInTheDocument();
    // KPI 与状态（KPI 标签 + 行内 pill 各一次）
    expect(screen.getAllByText('生成中').length).toBe(2);
    expect(screen.getAllByText('当前阶段').length).toBe(2);
  });

  it('加载失败展示可重试错误', async () => {
    mockList.mockRejectedValue(new Error('后端不可用'));
    renderPage();
    expect(await screen.findByText('项目列表加载失败')).toBeInTheDocument();
    // antd Button 会在两个汉字间插入空格
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeInTheDocument();
  });
});
