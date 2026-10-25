import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App as AntApp } from 'antd';
import { expect, it, vi } from 'vitest';
import type { PremisePreview, ProjectDetail } from '@rill/shared';
import { ProjectWorkspacePage } from './ProjectWorkspacePage';
import { useProject } from '../hooks/useProject';
import { WorkspaceProjectContext } from '../hooks/useWorkspaceProject';
import { previewPremise, adoptPremise, confirmStage } from '../api/novel';
import { makePremiseRow, makeProject, makeWorldRow, premiseData } from '../test/fixtures';

vi.mock('../hooks/useProject', () => ({ useProject: vi.fn() }));
vi.mock('../api/novel', async (original) => ({
  ...(await original<object>()),
  previewPremise: vi.fn(),
  adoptPremise: vi.fn(),
  confirmStage: vi.fn(),
}));
const noop = () => {};

it('工作台预览时禁用原操作，采用后刷新为 auto 种子待确认并显式继续', async () => {
  const original = makeProject({
    currentStage: 'world',
    mode: 'auto',
    premise: makePremiseRow(),
    world: makeWorldRow(),
  });
  const adopted = makeProject({
    ...original,
    currentStage: 'premise',
    premise: {
      ...makePremiseRow(),
      data: JSON.stringify({ ...premiseData, coreConflict: '新冲突' }),
    },
    world: makeWorldRow({ stale: true }),
    stageStates: {
      premise: { status: 'done', stale: false, error: null, confirmedAt: null },
      world: { status: 'done', stale: true, error: null, confirmedAt: null },
    },
  });
  let latest: ProjectDetail = original;
  let finish!: (value: PremisePreview) => void;
  vi.mocked(previewPremise).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.mocked(adoptPremise).mockImplementation(async () => {
    latest = adopted;
    return adopted;
  });
  vi.mocked(confirmStage).mockResolvedValue({ ...adopted, currentStage: 'world' });
  const refresh = vi.fn();
  function Host() {
    const [project, setProject] = useState(original);
    refresh.mockImplementation(async () => {
      setProject(latest);
      return latest;
    });
    vi.mocked(useProject).mockReturnValue({
      project,
      refresh,
      restartPolling: noop,
      loading: false,
      error: null,
    });
    return (
      <MemoryRouter>
        <AntApp>
          <WorkspaceProjectContext.Provider
            value={{
              project,
              setProject: noop,
              viewedStage: { kind: 'stage', stage: 'premise' },
              setViewedStage: noop,
            }}
          >
            <ProjectWorkspacePage />
          </WorkspaceProjectContext.Provider>
        </AntApp>
      </MemoryRouter>
    );
  }
  render(<Host />);
  fireEvent.change(screen.getByLabelText('修改建议'), { target: { value: '加强冲突' } });
  fireEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
  expect(screen.getByRole('button', { name: '重新生成' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '回退到此阶段' })).toBeDisabled();
  await act(async () =>
    finish({
      candidateId: 'candidate',
      premise: { ...premiseData, coreConflict: '新冲突' },
    } as PremisePreview),
  );
  await userEvent.click(screen.getByRole('button', { name: '采用修改' }));
  expect(await screen.findByText(/以下已有内容将失效/)).toHaveTextContent('世界观');
  await userEvent.click(screen.getByRole('button', { name: '确认采用' }));
  await waitFor(() => expect(screen.queryByText('候选种子（尚未采用）')).not.toBeInTheDocument());
  expect(confirmStage).not.toHaveBeenCalled();
  expect(screen.getByText('新冲突')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认并推进' }));
  await waitFor(() => expect(confirmStage).toHaveBeenCalledWith(original.id));
});
