import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App as AntApp } from 'antd';
import { NewProjectPage } from './NewProjectPage';
import { questionnaireFixture } from '../test/fixtures';

vi.mock('../api/novel', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQuestionnaire: vi.fn(),
  createProject: vi.fn(),
  generateStage: vi.fn(),
}));

import { createProject, generateStage, getQuestionnaire } from '../api/novel';

const mockGetQuestionnaire = vi.mocked(getQuestionnaire);
const mockCreate = vi.mocked(createProject);
const mockGenerate = vi.mocked(generateStage);
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => mockNavigate,
}));

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
  await userEvent.click(screen.getByRole('button', { name: '下一步' }));
  await screen.findByText('创作意图');
}

describe('NewProjectPage 问卷向导', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    ['仙侠', 'xianxia', true],
    ['炒股', 'chaogu', false],
    ['穿越', 'chuanyue', true],
    ['克苏鲁神话', 'cthulhu', true],
  ] as const)('新类型 %s 可创建且阶段预告正确', async (label, genre, hasWorld) => {
    mockGetQuestionnaire.mockResolvedValue(questionnaireFixture);
    mockCreate.mockResolvedValue({ id: 'new-project' } as never);
    renderPage();
    expect(screen.queryByRole('button', { name: /其他/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /历史/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('创作意图');
    expect(mockGetQuestionnaire).toHaveBeenCalledWith(genre);
    expect(Boolean(screen.queryByText('世界观'))).toBe(hasWorld);
    await userEvent.click(screen.getByRole('button', { name: '第三人称限知' }));
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ answers: expect.objectContaining({ genre: [genre] }) }),
    );
  });

  it('可多选和取消，空选择禁用下一步，返回保留选择并提交完整组合', async () => {
    mockGetQuestionnaire.mockResolvedValue(questionnaireFixture);
    mockCreate.mockResolvedValue({ id: 'multi' } as never);
    renderPage();
    const next = screen.getByRole('button', { name: '下一步' });
    expect(next).toBeDisabled();
    const city = screen.getByRole('button', { name: /都市/ });
    await userEvent.click(city);
    expect(city).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(city);
    expect(next).toBeDisabled();
    await userEvent.click(city);
    await userEvent.click(screen.getByRole('button', { name: /炒股/ }));
    await userEvent.click(screen.getByRole('button', { name: /穿越/ }));
    expect(screen.queryByText('创作意图')).not.toBeInTheDocument();
    await userEvent.click(next);
    await screen.findByText('创作意图');
    expect(mockGetQuestionnaire).toHaveBeenLastCalledWith(['dushi', 'chaogu', 'chuanyue']);
    expect(screen.getByRole('complementary')).toHaveTextContent('都市、炒股、穿越');
    expect(screen.getByRole('complementary')).toHaveTextContent('世界观');
    await userEvent.click(screen.getByText('返回更改'));
    expect(screen.getByRole('button', { name: /炒股/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await userEvent.click(screen.getByRole('button', { name: '第三人称限知' }));
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: expect.objectContaining({ genre: ['dushi', 'chaogu', 'chuanyue'] }),
      }),
    );
  });

  it('第一步选择类型后进入级联问卷', async () => {
    await gotoStep2();
    expect(mockGetQuestionnaire).toHaveBeenCalledWith('xuanhuan');
    expect(screen.getByRole('button', { name: '短篇' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '中篇' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '长篇' })).not.toBeInTheDocument();
    expect(screen.getAllByText('金手指类型').length).toBe(1); // 表单 + 摘要栏
  });

  it('文风默认选中，隐藏旧关系项并提交文风版本', async () => {
    mockGetQuestionnaire.mockResolvedValue({
      ...questionnaireFixture,
      questions: [
        ...questionnaireFixture.questions,
        {
          key: 'extras.relation',
          label: '关系设定',
          required: false,
          options: [{ value: '青梅竹马', label: '青梅竹马' }],
        },
      ],
    });
    mockCreate.mockResolvedValue({ id: 'prj_style' } as never);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /言情/ }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('创作意图');
    expect(screen.queryByText('关系设定')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '短篇爽文' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('complementary')).toHaveTextContent('短篇爽文');
    await userEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    await userEvent.click(screen.getByRole('button', { name: /玄幻/ }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByRole('button', { name: '短篇爽文' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: '第三人称限知' }));
    await userEvent.click(screen.getByRole('button', { name: /创建项目/ }));
    expect(mockCreate.mock.calls[0][0].answers.writingStyle).toEqual({
      id: 'short-satisfying',
      version: 'v1',
    });
    expect(mockCreate.mock.calls[0][0].answers.extras?.relation).toBeUndefined();
  });

  it('提交前本地校验必答项，缺失时阻止提交', async () => {
    await gotoStep2();
    await userEvent.click(screen.getByRole('button', { name: /创建项目/ }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('故事想法独立输入，书名可留空，忽略旧问卷中的阅读体验与职业', async () => {
    mockGetQuestionnaire.mockResolvedValue({
      ...questionnaireFixture,
      questions: [
        ...questionnaireFixture.questions,
        {
          key: 'extras.profession',
          label: '主角职业',
          required: false,
          options: [{ value: '商战', label: '商战' }],
        },
      ],
    });
    mockCreate.mockResolvedValue({ id: 'prj_idea' } as never);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /都市/ }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('创作意图');
    const idea = '一个男大学生在股市做短线，从一万元本金起步，最终赚到一个亿。';
    await userEvent.type(screen.getByRole('textbox', { name: '你想写什么故事？（选填）' }), idea);
    expect(screen.getByRole('complementary')).toHaveTextContent(idea);
    expect(screen.getByRole('complementary')).not.toHaveTextContent('世界观');
    expect(screen.queryByText('阅读体验')).not.toBeInTheDocument();
    expect(screen.queryByText('主角职业')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '第三人称限知' }));
    await userEvent.click(screen.getByRole('button', { name: /创建项目/ }));
    const body = mockCreate.mock.calls[0][0];
    expect(body.title).toBeUndefined();
    expect(body.answers.idea).toBe(idea);
    expect(body.answers).not.toHaveProperty('tone');
    expect(body.answers.extras?.profession).toBeUndefined();
  });

  it('超长故事想法就地报错，保留原文并阻止创建', async () => {
    await gotoStep2();
    const input = screen.getByRole('textbox', { name: '你想写什么故事？（选填）' });
    fireEvent.change(input, { target: { value: '甲'.repeat(2001) } });
    expect(input).toHaveValue('甲'.repeat(2001));
    expect(screen.getByRole('alert')).toHaveTextContent('故事想法最多 2000 字符');
    await userEvent.click(screen.getByRole('button', { name: '第三人称限知' }));
    await userEvent.click(screen.getByRole('button', { name: /创建项目/ }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('extras 前缀答案归入 answers.extras 并成功创建', async () => {
    mockCreate.mockResolvedValue({ id: 'prj_new' } as never);
    renderPage();
    expect(screen.queryByRole('textbox', { name: '项目标题' })).not.toBeInTheDocument();
    mockGetQuestionnaire.mockResolvedValue(questionnaireFixture);
    await userEvent.click(screen.getByRole('button', { name: /玄幻/ }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('创作意图');

    await userEvent.click(screen.getByText(/更多偏好/));
    const titleInput = screen.getByRole('textbox', { name: '书名（选填）' });
    expect(titleInput).toHaveAttribute('autocomplete', 'off');
    await userEvent.type(titleInput, '青川令新篇');
    await userEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    expect(screen.queryByRole('textbox', { name: '书名（选填）' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('创作意图');
    await userEvent.click(screen.getByText(/更多偏好/));
    expect(screen.getByRole('textbox', { name: '书名（选填）' })).toHaveValue('青川令新篇');

    await userEvent.click(screen.getByRole('button', { name: '短篇' }));
    await userEvent.click(screen.getByRole('button', { name: '第三人称限知' }));
    await userEvent.click(screen.getByRole('button', { name: '适中' }));
    await userEvent.click(screen.getByRole('button', { name: '天赋' }));
    await userEvent.click(screen.getByRole('button', { name: /创建项目/ }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = mockCreate.mock.calls[0][0];
    expect(body.title).toBe('青川令新篇');
    expect(body.mode).toBe('manual');
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(body.answers).toEqual({
      genre: ['xuanhuan'],
      length: 'short',
      pov: '第三人称限知',
      writingStyle: { id: 'short-satisfying', version: 'v1' },
      extras: { characterScale: 'standard', goldenFinger: '天赋' },
    });
  });

  it('自动模式在返回和更换类型后保留，并随创建请求提交', async () => {
    mockCreate.mockResolvedValue({ id: 'prj_auto' } as never);
    mockGenerate.mockResolvedValue({ started: true, auto: true } as never);
    mockGetQuestionnaire.mockResolvedValue(questionnaireFixture);
    renderPage();
    expect(screen.getByRole('radio', { name: '手动推进' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: '自动推进' }));
    await userEvent.click(screen.getByRole('button', { name: /玄幻/ }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('创作意图');
    await userEvent.click(screen.getByText('返回更改'));
    expect(screen.getByRole('radio', { name: '自动推进' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /悬疑/ }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('创作意图');
    expect(screen.getByRole('complementary')).toHaveTextContent('自动推进');
    await userEvent.click(screen.getByRole('button', { name: '短篇' }));
    await userEvent.click(screen.getByRole('button', { name: '第三人称限知' }));
    await userEvent.click(screen.getByRole('button', { name: /创建项目/ }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'auto' }));
    await waitFor(() => expect(mockGenerate).toHaveBeenCalledWith('prj_auto'));
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/projects/prj_auto'));
  });

  it('自动启动失败仍进入原项目，提示重试且不重复创建', async () => {
    mockCreate.mockResolvedValue({ id: 'prj_retry' } as never);
    mockGenerate.mockRejectedValue(new Error('网络连接中断'));
    mockGetQuestionnaire.mockResolvedValue(questionnaireFixture);
    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: '自动推进' }));
    await userEvent.click(screen.getByRole('button', { name: /玄幻/ }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('创作意图');
    await userEvent.click(screen.getByRole('button', { name: '短篇' }));
    await userEvent.click(screen.getByRole('button', { name: '第三人称限知' }));
    await userEvent.click(screen.getByRole('button', { name: /创建项目/ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/projects/prj_retry'));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledWith('prj_retry');
    expect(screen.getByText(/项目已创建，但自动推进启动未确认/)).toBeInTheDocument();
  });

  it('切换类型时保留必答已填值、清空上一类型级联选答', async () => {
    await gotoStep2();
    await userEvent.click(screen.getByText(/更多偏好/));
    await userEvent.click(screen.getByRole('button', { name: '短篇' }));
    await userEvent.click(screen.getByRole('button', { name: '适中' }));

    // 返回第一步换类型
    await userEvent.click(screen.getByText('返回更改'));
    await userEvent.click(screen.getByRole('button', { name: /悬疑/ }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('创作意图');

    // 必答（篇幅）保留；级联选答（人物数量）被清空
    expect(screen.getByRole('button', { name: '短篇' }).getAttribute('aria-pressed')).toBe('true');
    const rail = screen.getByRole('complementary');
    expect(rail.textContent).not.toContain('人物数量');
    expect(rail.textContent).toContain('未回答');
  });
});
