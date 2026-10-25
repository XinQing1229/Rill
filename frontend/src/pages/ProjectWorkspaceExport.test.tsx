import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App as AntApp } from 'antd';
import { WorkspaceProjectContext, type WorkspaceProjectValue } from '../hooks/useWorkspaceProject';
import { useProject } from '../hooks/useProject';
import { makeProject } from '../test/fixtures';
import { ProjectWorkspacePage } from './ProjectWorkspacePage';
import { generateStage } from '../api/novel';
vi.mock('../hooks/useProject', () => ({ useProject: vi.fn() }));
vi.mock('../components/book-export/BookExportWorkbench', () => ({
  BookExportWorkbench: () => <div>独立导出工作区</div>,
}));
vi.mock('../components/pipeline/StagePanel', () => ({ StagePanel: () => <div>创作阶段面板</div> }));
vi.mock('../api/novel', async (original) => ({
  ...(await original<object>()),
  generateStage: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
it('进入导出工作区不改变创作状态，刷新项目不撤销查看目标', () => {
  const project = makeProject();
  vi.mocked(useProject).mockReturnValue({
    project,
    loading: false,
    error: null,
    refresh: vi.fn(),
    restartPolling: vi.fn(),
  });
  const setViewedStage = vi.fn();
  const value: WorkspaceProjectValue = {
    project,
    setProject: vi.fn(),
    viewedStage: { kind: 'book-export' },
    setViewedStage,
  };
  const tree = () => (
    <MemoryRouter>
      <AntApp>
        <WorkspaceProjectContext.Provider value={value}>
          <ProjectWorkspacePage />
        </WorkspaceProjectContext.Provider>
      </AntApp>
    </MemoryRouter>
  );
  const view = render(tree());
  expect(screen.getByText('独立导出工作区')).toBeInTheDocument();
  expect(screen.queryByText('创作阶段面板')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '确认并推进' })).not.toBeInTheDocument();
  vi.mocked(useProject).mockReturnValue({
    project: { ...project },
    loading: false,
    error: null,
    refresh: vi.fn(),
    restartPolling: vi.fn(),
  });
  view.rerender(tree());
  expect(setViewedStage).not.toHaveBeenCalled();
  expect(generateStage).not.toHaveBeenCalled();
});
