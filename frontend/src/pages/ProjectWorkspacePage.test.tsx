import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App as AntApp } from 'antd';
import { ProjectWorkspacePage } from './ProjectWorkspacePage';
import { makeProject } from '../test/fixtures';
import { useProject } from '../hooks/useProject';
import { ApiError } from '../api/client';
import { generateStage, setMode } from '../api/novel';

vi.mock('../hooks/useProject', () => ({ useProject: vi.fn() }));
vi.mock('../components/pipeline/StagePanel', () => ({ StagePanel: () => null }));
vi.mock('../api/novel', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setMode: vi.fn(),
  generateStage: vi.fn(),
}));

const refresh = vi.fn();
const restartPolling = vi.fn();

function page(project = makeProject()) {
  vi.mocked(useProject).mockReturnValue({
    project,
    loading: false,
    error: null,
    refresh,
    restartPolling,
  });
  return render(
    <MemoryRouter>
      <AntApp>
        <ProjectWorkspacePage />
      </AntApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  refresh.mockResolvedValue(null);
  vi.mocked(setMode).mockResolvedValue(makeProject({ mode: 'auto' }));
});

describe('工作台推进模式设置', () => {
  it('默认只显示模式，取消不保存，再打开恢复当前模式', async () => {
    page();
    expect(screen.getByText('手动推进')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '项目设置' }));
    await userEvent.click(screen.getByRole('radio', { name: '自动推进' }));
    await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(setMode).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '项目设置' }));
    expect(screen.getByRole('radio', { name: '手动推进' })).toBeChecked();
    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled();
  });

  it('明确保存后更新模式并刷新，不启动生成', async () => {
    const project = makeProject();
    page(project);
    await userEvent.click(screen.getByRole('button', { name: '项目设置' }));
    await userEvent.click(screen.getByRole('radio', { name: '自动推进' }));
    expect(setMode).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(setMode).toHaveBeenCalledWith(project.id, 'auto'));
    expect(refresh).toHaveBeenCalled();
    expect(generateStage).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('运行中锁定选择和保存并解释原因', async () => {
    page(makeProject({ status: 'running' }));
    await userEvent.click(screen.getByRole('button', { name: '项目设置' }));
    expect(screen.getByRole('radio', { name: '手动推进' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '自动推进' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('项目正在生成');
    expect(setMode).not.toHaveBeenCalled();
  });

  it('保存冲突时保留设置弹窗并刷新项目状态', async () => {
    vi.mocked(setMode).mockRejectedValue(new ApiError(409, '项目正在运行'));
    page();
    await userEvent.click(screen.getByRole('button', { name: '项目设置' }));
    await userEvent.click(screen.getByRole('radio', { name: '自动推进' }));
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '自动推进' })).toBeChecked();
  });
});

it('项目概览显示书名、实际阶段数、日期及问卷维度', () => {
  const project = makeProject({
    stages: ['premise', 'characters', 'relations', 'outline', 'prose'],
  });
  page(project);
  const overview = within(screen.getByRole('region', { name: '项目信息' }));
  expect(overview.getByRole('heading', { name: project.title, level: 1 })).toBeInTheDocument();
  expect(overview.getByText('5 个阶段')).toBeInTheDocument();
  expect(overview.getByText('2026-01-01')).toHaveAttribute('dateTime', project.updatedAt);
  expect(overview.getByText('第三人称限知')).toBeInTheDocument();
  expect(overview.getByText('待操作')).toBeInTheDocument();
});
