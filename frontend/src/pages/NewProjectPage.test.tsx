import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App as AntApp } from 'antd';
import { NewProjectPage } from './NewProjectPage';
import { questionnaireFixture } from '../test/fixtures';

vi.mock('../api/novel', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQuestionnaire: vi.fn(),
  createProject: vi.fn(),
}));

import { createProject, getQuestionnaire } from '../api/novel';

const mockGetQuestionnaire = vi.mocked(getQuestionnaire);
const mockCreate = vi.mocked(createProject);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/new']}>
      <AntApp>
        <NewProjectPage />
      </AntApp>
    </MemoryRouter>,
  );
}

async function gotoStep2() {
  mockGetQuestionnaire.mockResolvedValue(questionnaireFixture);
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: /玄幻/ }));
  await screen.findByText('创作意图');
}

describe('NewProjectPage 问卷向导', () => {
  it('第一步选择类型后进入级联问卷', async () => {
    await gotoStep2();
    expect(mockGetQuestionnaire).toHaveBeenCalledWith('xuanhuan');
    expect(screen.getByRole('button', { name: '中篇' })).toBeInTheDocument();
    expect(screen.getAllByText('金手指类型').length).toBe(2); // 表单 + 摘要栏
  });

  it('提交前本地校验必答项，缺失时阻止提交', async () => {
    await gotoStep2();
    await userEvent.click(screen.getByRole('button', { name: /创建项目/ }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('extras 前缀答案归入 answers.extras 并成功创建', async () => {
    mockCreate.mockResolvedValue({ id: 'prj_new' } as never);
    renderPage();
    // 标题在第一步填写
    await userEvent.type(screen.getByPlaceholderText('给你的小说起个名字'), '青川令');
    mockGetQuestionnaire.mockResolvedValue(questionnaireFixture);
    await userEvent.click(screen.getByRole('button', { name: /玄幻/ }));
    await screen.findByText('创作意图');

    await userEvent.click(screen.getByRole('button', { name: '中篇' }));
    await userEvent.click(screen.getByRole('button', { name: '热血' }));
    await userEvent.click(screen.getByRole('button', { name: '第三人称限知' }));
    await userEvent.click(screen.getByRole('button', { name: '标准' }));
    await userEvent.click(screen.getByRole('button', { name: '天赋' }));
    await userEvent.click(screen.getByRole('button', { name: /创建项目/ }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = mockCreate.mock.calls[0][0];
    expect(body.title).toBe('青川令');
    expect(body.answers).toEqual({
      genre: 'xuanhuan',
      length: 'medium',
      tone: '热血',
      pov: '第三人称限知',
      extras: { characterScale: 'standard', goldenFinger: '天赋' },
    });
  });

  it('切换类型时保留必答已填值、清空上一类型级联选答', async () => {
    await gotoStep2();
    await userEvent.click(screen.getByRole('button', { name: '中篇' }));
    await userEvent.click(screen.getByRole('button', { name: '标准' }));

    // 返回第一步换类型
    await userEvent.click(screen.getByText('返回更改'));
    await userEvent.click(screen.getByRole('button', { name: /悬疑/ }));
    await screen.findByText('创作意图');

    // 必答（篇幅）保留；级联选答（人物规模）被清空
    expect(screen.getByRole('button', { name: '中篇' }).getAttribute('aria-pressed')).toBe('true');
    const rail = screen.getByRole('complementary');
    expect(rail.textContent).toContain('人物规模');
    expect(rail.textContent).toContain('未回答');
  });
});
