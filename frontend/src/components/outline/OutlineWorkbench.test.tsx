import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutlineDetail } from '@rill/shared';
import { makeProject, makeCharacterRow } from '../../test/fixtures';
import { OutlineWorkbench } from './OutlineWorkbench';
import * as api from '../../api/novel';
vi.mock('../../api/novel', () => ({
  getOutline: vi.fn(),
  configureOutline: vi.fn(),
  confirmOutline: vi.fn(),
  generateStage: vi.fn(),
  saveOutlineChapter: vi.fn(),
  saveOutlinePlan: vi.fn(),
}));
function detail(): OutlineDetail {
  return {
    targetChapters: 8,
    step: 'plan_review',
    revision: 1,
    planRevision: 1,
    planConfirmedRevision: null,
    confirmedRevision: null,
    stale: false,
    completedChapters: 0,
    completedBatches: 0,
    totalBatches: 1,
    error: null,
    plan: {
      mainline: '原主线',
      turningPoints: ['原转折'],
      climax: '原高潮',
      ending: '原结局',
      characterArcs: [{ characterId: 'c1', development: '成长' }],
      relationDevelopments: [],
      segments: [
        {
          id: 'act',
          title: '起',
          goal: '寻',
          events: '调查',
          outcome: '结果',
          startChapter: 1,
          endChapter: 8,
        },
      ],
    },
    chapters: [],
    staleChapters: [],
    batches: [],
  };
}
function show(data = detail(), running = false) {
  vi.mocked(api.getOutline).mockResolvedValue(data);
  const project = makeProject({
    id: 'outline-project',
    currentStage: 'outline',
    stageStates: Object.fromEntries(
      ['premise', 'world', 'characters', 'relations'].map((stage) => [
        stage,
        { status: 'done', stale: false, error: null, confirmedAt: '2026-10-22T00:00:00Z' },
      ]),
    ),
    status: running ? 'running' : 'idle',
    characters: [makeCharacterRow('主角', 'protagonist', { id: 'c1' })],
  });
  return render(
    <App>
      <OutlineWorkbench project={project} onRollback={vi.fn()} />
    </App>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
});
describe('大纲编辑和确认', { timeout: 15000 }, () => {
  it('未保存修改阻止确认，保存本身不发起确认', async () => {
    show();
    const field = await screen.findByLabelText('全书主线');
    fireEvent.change(field, { target: { value: '作者主线' } });
    expect(screen.getByText('确认规划并展开章纲').closest('button')!).toBeDisabled();
    fireEvent.click(screen.getByText('保存全书规划').closest('button')!);
    await waitFor(() =>
      expect(api.saveOutlinePlan).toHaveBeenCalledWith(
        'outline-project',
        1,
        expect.objectContaining({ mainline: '作者主线' }),
      ),
    );
    expect(api.confirmOutline).not.toHaveBeenCalled();
  });
  it('版本冲突保留本地输入并提示核对', async () => {
    vi.mocked(api.saveOutlinePlan).mockRejectedValue(new Error('内容版本冲突，请刷新后核对'));
    show();
    fireEvent.change(await screen.findByLabelText('全书主线'), { target: { value: '保留输入' } });
    fireEvent.click(screen.getByText('保存全书规划').closest('button')!);
    await screen.findByText('内容版本冲突，请刷新后核对');
    expect(screen.getByLabelText('全书主线')).toHaveValue('保留输入');
  });
  it('生成中禁用编辑和确认', async () => {
    show(detail(), true);
    expect(await screen.findByLabelText('全书主线')).toBeDisabled();
    expect(screen.getByText('确认规划并展开章纲').closest('button')!).toBeDisabled();
  });
  it('显示失败批次的章号与原因，并提供续跑', async () => {
    show({
      ...detail(),
      step: 'expanding',
      completedChapters: 20,
      targetChapters: 25,
      completedBatches: 2,
      totalBatches: 3,
      error: '生成中断，可续跑',
      batches: [
        { startChapter: 1, endChapter: 10, status: 'done', error: null },
        { startChapter: 11, endChapter: 20, status: 'done', error: null },
        { startChapter: 21, endChapter: 25, status: 'failed', error: '分段失败' },
      ],
    });
    await screen.findByText('1 个批次尚未生成成功');
    const failed = screen.getByText(/第 21–25 章：/);
    expect(failed.textContent).toContain('分段失败');
    expect(screen.getByText('已完成 20 / 25 章 · 2 / 3 批')).toBeInTheDocument();
    fireEvent.click(screen.getByText('续跑失败步骤').closest('button')!);
    await waitFor(() => expect(api.generateStage).toHaveBeenCalledWith('outline-project'));
  });
  it('规划确认提交明确目标和所见版本', async () => {
    show();
    fireEvent.click(
      await screen.findByText('确认规划并展开章纲').then((element) => element.closest('button')!),
    );
    await waitFor(() =>
      expect(api.confirmOutline).toHaveBeenCalledWith('outline-project', {
        target: 'outline-plan',
        expectedRevision: 1,
      }),
    );
  });
  it('200 章按段浏览，只在选中时挂载单章编辑表单', async () => {
    const data = detail();
    data.step = 'outline_review';
    data.targetChapters = 200;
    data.completedChapters = 200;
    data.chapters = Array.from({ length: 200 }, (_, i) => ({
      number: i + 1,
      segmentId: 'act',
      title: `章${i + 1}`,
      events: '事件',
      characterIds: ['c1'],
      conflict: '冲突',
      outcome: '结果',
      consequence: '后续',
    }));
    show(data);
    await screen.findByText('确认完整大纲并进入正文').then((element) => element.closest('button')!);
    expect(screen.queryByLabelText('章名')).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox').length).toBeLessThan(25);
  });
  it('非法规划在本地被拒绝，不提交保存', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('全书主线'), { target: { value: '' } });
    fireEvent.click(screen.getByText('保存全书规划').closest('button')!);
    await screen.findByText(/mainline:/);
    expect(api.saveOutlinePlan).not.toHaveBeenCalled();
  });

  it('编辑单章后保存，完整确认发送当前版本', async () => {
    const data = detail();
    data.step = 'outline_review';
    data.planConfirmedRevision = 1;
    data.targetChapters = 1;
    data.completedChapters = 1;
    data.chapters = [
      {
        number: 1,
        segmentId: 'act',
        title: '第一章',
        events: '原事件',
        characterIds: ['c1'],
        conflict: '冲突',
        outcome: '结果',
        consequence: '后续',
      },
    ];
    show(data);
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '选择编辑章节' }));
    fireEvent.click(await screen.findByText('第 1 章 · 第一章'));
    fireEvent.change(await screen.findByLabelText('主要事件'), {
      target: { value: '作者单章修改' },
    });
    expect(screen.getByText('确认完整大纲并进入正文').closest('button')!).toBeDisabled();
    fireEvent.click(screen.getByText('保存本章概要').closest('button')!);
    await waitFor(() =>
      expect(api.saveOutlineChapter).toHaveBeenCalledWith(
        'outline-project',
        1,
        expect.objectContaining({ number: 1, events: '作者单章修改' }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText('确认完整大纲并进入正文').closest('button')!).toBeEnabled(),
    );
    fireEvent.click(screen.getByText('确认完整大纲并进入正文').closest('button')!);
    await waitFor(() =>
      expect(api.confirmOutline).toHaveBeenCalledWith('outline-project', {
        target: 'outline',
        expectedRevision: 1,
      }),
    );
  }, 30_000);

  it('已确认步骤提供沿用指标纲的推进入口，未保存修改时不阻塞', async () => {
    show({ ...detail(), step: 'confirmed', confirmedRevision: 1, targetChapters: 0 });
    const button = await screen.findByText('沿用已确认大纲并进入正文');
    expect(button.closest('button')!).toBeEnabled();
    fireEvent.click(button.closest('button')!);
    await waitFor(() =>
      expect(api.confirmOutline).toHaveBeenCalledWith('outline-project', {
        target: 'outline',
        expectedRevision: 1,
      }),
    );
  });

  it('自定义目标章数采用作者输入', async () => {
    show({ ...detail(), plan: null, step: 'planning', revision: 0 });
    fireEvent.change(await screen.findByRole('spinbutton', { name: '目标章数' }), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByText('保存章数').closest('button')!);
    await waitFor(() =>
      expect(api.configureOutline).toHaveBeenCalledWith('outline-project', 0, 12),
    );
  });

  it('修改已有章纲的规划先提示失效范围，确认后才保存', async () => {
    show({ ...detail(), completedChapters: 8 });
    fireEvent.change(await screen.findByLabelText('全书主线'), { target: { value: '改写主线' } });
    fireEvent.click(screen.getByText('保存全书规划').closest('button')!);
    expect((await screen.findAllByText('修改规划将使章纲与下游失效')).length).toBeGreaterThan(0);
    expect(api.saveOutlinePlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^(OK|确\s*定)$/ }));
    await waitFor(() => expect(api.saveOutlinePlan).toHaveBeenCalled());
  });
});
