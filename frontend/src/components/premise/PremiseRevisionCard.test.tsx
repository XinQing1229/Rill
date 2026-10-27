import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { PremiseRevisionCard } from './PremiseRevisionCard';
import { StagePanel } from '../pipeline/StagePanel';
import { previewPremise, adoptPremise } from '../../api/novel';
import { makePremiseRow, makeProject, premiseData } from '../../test/fixtures';
import { ApiError } from '../../api/client';
import type { PremisePreview } from '@rill/shared';

vi.mock('../../api/novel', async (original) => ({
  ...(await original<object>()),
  previewPremise: vi.fn(),
  adoptPremise: vi.fn(),
}));
const candidate = {
  candidateId: 'candidate',
  premise: { ...premiseData, coreConflict: '候选核心冲突' },
} as PremisePreview;
const onBusyChange = vi.fn();
const onChanged = vi.fn();
const project = () => makeProject({ premise: makePremiseRow() });
function card() {
  return render(
    <PremiseRevisionCard
      project={project()}
      busy={false}
      onBusyChange={onBusyChange}
      onChanged={onChanged}
    />,
  );
}
async function generate() {
  fireEvent.change(screen.getByLabelText('修改建议'), { target: { value: '加强冲突' } });
  await userEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
  await screen.findByText('候选核心冲突');
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewPremise).mockResolvedValue(candidate);
  vi.mocked(adoptPremise).mockResolvedValue(project());
});

it('首次失败保留输入，没有可采用候选；空建议不提交', async () => {
  card();
  await userEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
  expect(await screen.findByText('请填写修改建议')).toBeInTheDocument();
  expect(previewPremise).not.toHaveBeenCalled();
  vi.mocked(previewPremise).mockRejectedValue(new Error('模型不可用'));
  fireEvent.change(screen.getByLabelText('修改建议'), { target: { value: '加强冲突' } });
  await userEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
  expect(await screen.findByText('模型不可用')).toBeInTheDocument();
  expect(screen.getByLabelText('修改建议')).toHaveValue('加强冲突');
  expect(screen.queryByRole('button', { name: '采用修改' })).not.toBeInTheDocument();
});

it('再次失败保留上次完整预览和本次建议，放弃不修改正式内容', async () => {
  card();
  await generate();
  vi.mocked(previewPremise).mockRejectedValue(new Error('新一轮失败'));
  fireEvent.change(screen.getByLabelText('修改建议'), { target: { value: '再加强冲突' } });
  await userEvent.click(screen.getByRole('button', { name: '重新生成修改预览' }));
  expect(await screen.findByText('新一轮失败')).toBeInTheDocument();
  expect(screen.getByLabelText('修改建议')).toHaveValue('再加强冲突');
  expect(screen.getByText('候选核心冲突')).toBeInTheDocument();
  expect(screen.getByText(premiseData.protagonist.name)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /放\s*弃/ }));
  expect(screen.queryByText('候选核心冲突')).not.toBeInTheDocument();
  expect(adoptPremise).not.toHaveBeenCalled();
});

it('采用先提示影响，取消不提交；失败保留建议和候选', async () => {
  card();
  await generate();
  await userEvent.click(screen.getByRole('button', { name: '采用修改' }));
  expect(await screen.findByText('采用修改并回到种子待确认？')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
  expect(adoptPremise).not.toHaveBeenCalled();
  vi.mocked(adoptPremise).mockRejectedValue(new ApiError(409, '项目正在运行'));
  await userEvent.click(screen.getByRole('button', { name: '采用修改' }));
  await userEvent.click(await screen.findByRole('button', { name: '确认采用' }));
  expect(await screen.findByText('项目正在运行')).toBeInTheDocument();
  expect(adoptPremise).toHaveBeenCalledWith(project().id, 'candidate');
  expect(screen.getByText('候选核心冲突')).toBeInTheDocument();
  expect(screen.getByLabelText('修改建议')).toHaveValue('加强冲突');
  expect(onChanged).toHaveBeenCalled();
});

it('同步防重，pending 时保留旧预览且禁用冲突操作', async () => {
  card();
  await generate();
  let finish!: (value: PremisePreview) => void;
  vi.mocked(previewPremise).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const button = screen.getByRole('button', { name: '重新生成修改预览' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(previewPremise).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '采用修改' })).toBeDisabled();
  expect(screen.getByText('候选核心冲突')).toBeInTheDocument();
  await act(async () => finish(candidate));
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
});

it('项目运行时不能生成或采用，过期响应不更新已卸载卡片', async () => {
  const view = render(
    <PremiseRevisionCard
      project={{ ...project(), status: 'running' }}
      busy={false}
      onBusyChange={onBusyChange}
    />,
  );
  expect(screen.getByRole('button', { name: '生成修改预览' })).toBeDisabled();
  view.unmount();
  let finish!: (value: PremisePreview) => void;
  vi.mocked(previewPremise).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const previous = card();
  fireEvent.change(screen.getByLabelText('修改建议'), { target: { value: '建议' } });
  fireEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
  previous.unmount();
  render(
    <PremiseRevisionCard
      project={{ ...project(), id: 'other' }}
      busy={false}
      onBusyChange={vi.fn()}
    />,
  );
  await act(async () => finish(candidate));
  expect(screen.queryByText('候选核心冲突')).not.toBeInTheDocument();
});

it('卡片位于正式种子之后且标题栏集中阶段操作，回看可用，自动模式待确认可继续', async () => {
  const onConfirm = vi.fn();
  const view = render(
    <StagePanel
      project={{ ...project(), currentStage: 'outline' }}
      stage="premise"
      busy={false}
      onGenerate={vi.fn()}
      onConfirm={onConfirm}
      onRollback={vi.fn()}
    />,
  );
  const heading = screen.getByRole('heading', { name: '按建议修改' });
  const revision = screen.getByRole('region', { name: '按建议修改' });
  expect(within(revision).getByRole('button', { name: '重新生成' })).toBeEnabled();
  expect(within(revision).getByRole('button', { name: '回退到此阶段' })).toBeEnabled();
  expect(
    screen.getByRole('region', { name: '避雷' }).compareDocumentPosition(heading) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: '生成修改预览' })).toBeEnabled();
  await generate();
  expect(screen.getByText(premiseData.coreConflict)).toBeInTheDocument();
  view.rerender(
    <StagePanel
      project={{
        ...project(),
        mode: 'auto',
        stageStates: {
          premise: {
            status: 'done',
            stale: false,
            error: null,
            confirmedAt: null,
          },
        },
      }}
      stage="premise"
      busy={false}
      onGenerate={vi.fn()}
      onConfirm={onConfirm}
      onRollback={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: '确认并推进' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it('采用成功刷新并移除候选', async () => {
  card();
  await generate();
  await userEvent.click(screen.getByRole('button', { name: '采用修改' }));
  await userEvent.click(await screen.findByRole('button', { name: '确认采用' }));
  await waitFor(() => expect(screen.queryByText('候选核心冲突')).not.toBeInTheDocument());
  expect(onChanged).toHaveBeenCalled();
});

it('摘要先于完整候选展示，失败后成套保留，放弃时一起清除', async () => {
  vi.mocked(previewPremise).mockResolvedValue({
    ...candidate,
    changeSummary: {
      version: 1,
      changes: [
        {
          path: 'coreConflict',
          before: premiseData.coreConflict,
          after: candidate.premise.coreConflict,
          description: '新增需要男女主共同应对的矛盾',
          descriptionSource: 'ai',
        },
      ],
    },
  });
  card();
  fireEvent.change(screen.getByLabelText('修改建议'), { target: { value: '增加互动' } });
  await userEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
  const summary = await screen.findByRole('region', { name: '本次修改' });
  expect(
    summary.compareDocumentPosition(screen.getByText('候选种子（尚未采用）')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  vi.mocked(previewPremise).mockRejectedValueOnce(new Error('再次失败'));
  fireEvent.change(screen.getByLabelText('修改建议'), { target: { value: '再增加互动' } });
  await userEvent.click(screen.getByRole('button', { name: '重新生成修改预览' }));
  await screen.findByText('再次失败');
  expect(screen.getByText('新增需要男女主共同应对的矛盾')).toBeVisible();
  expect(screen.getByLabelText('修改建议')).toHaveValue('再增加互动');
  expect(screen.getByText('候选种子（尚未采用）')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /放\s*弃/ }));
  expect(screen.queryByRole('region', { name: '本次修改' })).not.toBeInTheDocument();
});
