import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProjectListPage } from './ProjectListPage';
import { makeProject, makeSummary } from '../test/fixtures';
import { ApiError } from '../api/client';

vi.mock('../api/novel', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listProjects: vi.fn(),
  deleteProject: vi.fn(),
  restoreProject: vi.fn(),
  purgeProject: vi.fn(),
  clearTrash: vi.fn(),
  setPublicationStatus: vi.fn(),
}));

import {
  clearTrash,
  deleteProject,
  listProjects,
  purgeProject,
  restoreProject,
  setPublicationStatus,
} from '../api/novel';

const mockList = vi.mocked(listProjects);
const mockDelete = vi.mocked(deleteProject);
const mockRestore = vi.mocked(restoreProject);
const mockPurge = vi.mocked(purgeProject);
const mockClearTrash = vi.mocked(clearTrash);
const mockPublication = vi.mocked(setPublicationStatus);

const deleted = makeSummary({ deletedAt: '2026-01-02T08:00:00.000Z', status: 'failed' });

/** 点击浮层内的按钮：antd 会在汉字之间插入空格，按去掉空白后的文本匹配 */
async function clickOverlayButton(selector: string, name: string) {
  const root = await waitFor(() => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`浮层未出现: ${selector}`);
    return node as HTMLElement;
  });
  const target = Array.from(root.querySelectorAll('button')).find(
    (button) => (button.textContent ?? '').replace(/\s+/g, '') === name,
  );
  if (!target) throw new Error(`${selector} 中没有按钮: ${name}`);
  fireEvent.click(target);
}

const confirmPopconfirm = (name: string) => clickOverlayButton('.ant-popconfirm', name);
const confirmModal = (name: string) => clickOverlayButton('.ant-modal-footer', name);

/** 取页面上的按钮（含标题区与列表行），按去空白后的文本精确匹配 */
function rowButton(name: string) {
  const target = Array.from(document.body.querySelectorAll('button')).find(
    (button) => (button.textContent ?? '').replace(/\s+/g, '') === name,
  );
  if (!target) throw new Error(`列表中没有按钮: ${name}`);
  return target;
}

async function switchScope(name: '全部项目' | '回收站') {
  const label = screen.getByText(name).closest('label');
  expect(label).not.toBeNull();
  fireEvent.click(label!);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<ProjectListPage />} />
        <Route path="/projects/:id" element={<div>创作工作台</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderActiveList() {
  mockList.mockResolvedValue([makeSummary({ status: 'idle' })]);
  renderPage();
  await screen.findByText('青川令');
}

describe('ProjectListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('空状态给出新建引导', async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument();
  });

  it('展示项目概要与状态', async () => {
    mockList.mockResolvedValue([
      makeSummary({ status: 'idle' }),
      makeSummary({
        id: 'p2',
        title: '雾港来信',
        genre: 'xuanyi',
        status: 'running',
        currentStage: 'world',
      }),
    ]);
    renderPage();
    expect(await screen.findByText('青川令')).toBeInTheDocument();
    expect(screen.getByText('雾港来信')).toBeInTheDocument();
    // KPI 与状态（KPI 标签 + 行内 pill 各一次）
    expect(screen.getAllByText('生成中').length).toBe(2);
    expect(screen.getAllByText('当前阶段').length).toBe(2);
  });

  it('搜索按名称筛选，统计仍保留全部项目数量，清空后恢复列表', async () => {
    mockList.mockResolvedValue([makeSummary(), makeSummary({ id: 'p2', title: '雾港来信' })]);
    renderPage();
    await screen.findByText('青川令');
    const search = screen.getByRole('textbox', { name: '搜索项目' });
    fireEvent.change(search, { target: { value: ' 雾港 ' } });
    expect(screen.queryByText('青川令')).not.toBeInTheDocument();
    expect(screen.getByText('雾港来信')).toBeInTheDocument();
    expect(screen.getByText('2 个创作项目，按最近更新排序')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '找不到' } });
    expect(screen.getByText('没有找到匹配的项目')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('青川令')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('项目卡片支持键盘进入工作台，封面为空白占位', async () => {
    await renderActiveList();
    const row = screen.getByText('青川令').closest('[role="button"]')!;
    expect(row.querySelector('.project-cover')).toBeEmptyDOMElement();
    fireEvent.keyDown(row, { key: ' ' });
    expect(await screen.findByText('创作工作台')).toBeInTheDocument();
  });

  it('加载失败展示可重试错误', async () => {
    mockList.mockRejectedValue(new Error('后端不可用'));
    renderPage();
    expect(await screen.findByText('项目列表加载失败')).toBeInTheDocument();
    // antd Button 会在两个汉字间插入空格
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeInTheDocument();
  });

  it.each([
    ['writing', 'published', '已发布'],
    ['published', 'writing', '创作中'],
  ] as const)('发布状态从 %s 手动切换为 %s，刷新列表且不进入工作台', async (from, to, label) => {
    mockList
      .mockResolvedValueOnce([makeSummary({ publicationStatus: from })])
      .mockResolvedValue([makeSummary({ publicationStatus: to })]);
    mockPublication.mockResolvedValue({ publicationStatus: to });
    renderPage();
    const select = await screen.findByRole('combobox', { name: '青川令的发布状态' });
    fireEvent.mouseDown(select);
    fireEvent.click(
      await screen.findByText(label, { selector: '.ant-select-item-option-content' }),
    );
    await waitFor(() =>
      expect(mockPublication).toHaveBeenCalledWith('prj_1', { publicationStatus: to }),
    );
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('创作工作台')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).not.toBeDisabled();
  });

  it('发布状态保存中禁用选择，失败显示原因且保留原值', async () => {
    let rejectSave!: (error: Error) => void;
    mockPublication.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    await renderActiveList();
    const select = screen.getByRole('combobox', { name: '青川令的发布状态' });
    fireEvent.mouseDown(select);
    fireEvent.click(
      await screen.findByText('已发布', { selector: '.ant-select-item-option-content' }),
    );
    await waitFor(() => expect(select).toBeDisabled());
    rejectSave(new Error('保存发布状态失败'));
    expect(await screen.findByText('保存发布状态失败')).toBeInTheDocument();
    expect(
      screen.getByText('创作中', { selector: '.ant-select-selection-item' }),
    ).toBeInTheDocument();
    expect(select).not.toBeDisabled();
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('删除需确认，确认后项目离开创作列表', async () => {
    mockList.mockResolvedValueOnce([makeSummary({ status: 'idle' })]).mockResolvedValue([]);
    mockDelete.mockResolvedValue(deleted);
    renderPage();
    await screen.findByText('青川令');

    fireEvent.click(screen.getByRole('button', { name: '青川令的更多操作' }));
    fireEvent.click(await screen.findByRole('button', { name: /删\s*除/ }));
    await screen.findByText('删除后进入回收站，可在回收站恢复；产物会完整保留。');
    await confirmPopconfirm('删除');

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('prj_1'));
    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument();
  });

  it('删除失败展示后端文案且列表不乐观更新', async () => {
    mockDelete.mockRejectedValue(new ApiError(409, '项目正在生成，请稍后删除'));
    await renderActiveList();

    fireEvent.click(screen.getByRole('button', { name: '青川令的更多操作' }));
    fireEvent.click(await screen.findByRole('button', { name: /删\s*除/ }));
    await confirmPopconfirm('删除');

    expect(await screen.findByText('项目正在生成，请稍后删除')).toBeInTheDocument();
    expect(screen.getByText('青川令')).toBeInTheDocument();
  });

  it('回收站视图展示删除时刻并支持恢复', async () => {
    mockList.mockResolvedValueOnce([]).mockResolvedValueOnce([deleted]);
    mockRestore.mockResolvedValue(makeProject());
    renderPage();
    await screen.findByText(/还没有项目/);

    await switchScope('回收站');

    expect(await screen.findByText('青川令')).toBeInTheDocument();
    expect(mockList).toHaveBeenLastCalledWith('trash');
    expect(screen.getByText(/删除于/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /恢\s*复/ }));
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('prj_1'));
    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith('trash'));
  });

  it('回收站空状态给出说明', async () => {
    mockList.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    renderPage();
    await screen.findByText(/还没有项目/);

    await switchScope('回收站');
    expect(await screen.findByText(/回收站是空的/)).toBeInTheDocument();
  });

  it('永久删除需二次确认', async () => {
    mockList.mockResolvedValueOnce([]).mockResolvedValueOnce([deleted]).mockResolvedValue([]);
    mockPurge.mockResolvedValue({ id: 'prj_1', purged: true });
    renderPage();
    await screen.findByText(/还没有项目/);
    await switchScope('回收站');
    await screen.findByText('青川令');

    fireEvent.click(rowButton('永久删除'));
    await screen.findByText('删除后不可恢复，各阶段产物与用量记录一并清除。');
    await confirmPopconfirm('永久删除');

    await waitFor(() => expect(mockPurge).toHaveBeenCalledWith('prj_1'));
    expect(await screen.findByText(/回收站是空的/)).toBeInTheDocument();
  });

  it('清空回收站需弹窗确认', async () => {
    mockList.mockResolvedValueOnce([]).mockResolvedValueOnce([deleted]).mockResolvedValue([]);
    mockClearTrash.mockResolvedValue({ removed: 1 });
    renderPage();
    await screen.findByText(/还没有项目/);
    await switchScope('回收站');
    await screen.findByText('青川令');

    fireEvent.click(rowButton('清空回收站'));
    const dialog = await screen.findByText(/回收站内的所有项目将被永久删除/);
    expect(dialog).toBeInTheDocument();
    await confirmModal('清空回收站');

    await waitFor(() => expect(mockClearTrash).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/回收站是空的/)).toBeInTheDocument();
    const headerButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => (button.textContent ?? '').replace(/\s+/g, '') === '清空回收站',
    );
    expect((headerButton as HTMLButtonElement).disabled).toBe(true);
  });
});
