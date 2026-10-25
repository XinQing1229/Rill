import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ProseChapterDetail, ProseRevision } from '@rill/shared';
import * as api from '../../api/novel';
import { ProseRevisionCard } from './ProseRevisionCard';
vi.mock('../../api/novel', () => ({
  createProseRevision: vi.fn(),
  getProseRevision: vi.fn(),
  applyProseRevision: vi.fn(),
  discardProseRevision: vi.fn(),
}));
const hash = 'a'.repeat(64);
const scores = {
  consistency: 90,
  character: 90,
  pacing: 90,
  continuity: 90,
  foreshadow: 90,
  hook: 90,
  aesthetic: 90,
};
function chapter(): ProseChapterDetail {
  return {
    chapterNumber: 1,
    path: '/a',
    content: '原文',
    revision: 2,
    observedHash: hash,
    confirmedHash: null,
    generationStatus: 'done',
    reviewStatus: 'pending',
    fileStatus: 'valid',
    machineStep: 'ai_review',
    candidates: [],
    error: null,
    stale: false,
    summary: null,
    report: {
      id: 'review1',
      sourceHash: hash,
      dependencyFingerprint: hash,
      promptVersion: 'v1',
      coveredChapters: [],
      verdict: 'polish',
      overrideReason: null,
      scores,
      issues: ['缩短独白', '加强悬念', '增加冲突'].map((suggestion) => ({
        dimension: 'pacing',
        severity: 'error',
        problem: suggestion,
        evidence: ['原文'],
        location: '第一段',
        basis: '节奏',
        suggestion,
      })),
    },
  };
}
function ready(): ProseRevision {
  return {
    id: 'r1',
    chapterNumber: 1,
    status: 'ready',
    baseRevision: 2,
    baseHash: hash,
    feedback: '',
    reviewId: 'review1',
    suggestions: [{ issueIndex: 0, problem: '缩短独白', suggestion: '缩短独白' }],
    content: '新正文',
    explanation: '',
    suggestionResponses: [{ issueIndex: 0, explanation: '删去了独白' }],
    changes: [{ before: '旧独白', after: '新动作' }],
    error: null,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
});
describe('按建议修改卡片', () => {
  it('默认不选，三选二只提交所选索引，允许补充要求', async () => {
    vi.mocked(api.createProseRevision).mockResolvedValue({
      ...ready(),
      suggestions: [ready().suggestions[0], { issueIndex: 1, problem: '', suggestion: '' }],
      feedback: '更简洁',
    });
    render(
      <ProseRevisionCard projectId="p" chapter={chapter()} disabled={false} onChanged={vi.fn()} />,
    );
    expect(screen.getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: '生成修改预览' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.change(screen.getByLabelText('补充修改建议（可独立填写）'), {
      target: { value: '更简洁' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
    await waitFor(() =>
      expect(api.createProseRevision).toHaveBeenCalledWith(
        'p',
        1,
        expect.objectContaining({
          feedback: '更简洁',
          reviewSelection: { reviewId: 'review1', issueIndexes: [0, 1] },
          expectedRevision: 2,
          expectedHash: hash,
        }),
      ),
    );
  });
  it('全选和清空；自填要求可独立生成', async () => {
    vi.mocked(api.createProseRevision).mockResolvedValue({
      ...ready(),
      reviewId: null,
      suggestions: [],
      feedback: '调整结尾',
    });
    render(
      <ProseRevisionCard projectId="p" chapter={chapter()} disabled={false} onChanged={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getByText('已选 3 / 3 条')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空选择' }));
    expect(screen.getByText('已选 0 / 3 条')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('补充修改建议（可独立填写）'), {
      target: { value: '调整结尾' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
    await waitFor(() =>
      expect(api.createProseRevision).toHaveBeenCalledWith(
        'p',
        1,
        expect.not.objectContaining({ reviewSelection: expect.anything() }),
      ),
    );
  });
  it('恢复预览，改选后禁止应用，报告变化清空旧勾选', async () => {
    const c = { ...chapter(), activeRevision: ready() };
    const view = render(
      <ProseRevisionCard projectId="p" chapter={c} disabled={false} onChanged={vi.fn()} />,
    );
    expect(screen.getByText('本次修改 · 1 处')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用修改并重新审核' })).not.toBeDisabled();
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByRole('button', { name: '应用修改并重新审核' })).toBeDisabled();
    view.rerender(
      <ProseRevisionCard
        projectId="p"
        chapter={{ ...c, report: { ...c.report!, id: 'review2' } }}
        disabled={false}
        onChanged={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('已选 0 / 3 条')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '应用修改并重新审核' })).toBeDisabled();
  });
  it('应用绑定预览基础版本，失败保留预览', async () => {
    vi.mocked(api.applyProseRevision).mockRejectedValue(new Error('版本冲突'));
    render(
      <ProseRevisionCard
        projectId="p"
        chapter={{ ...chapter(), activeRevision: ready() }}
        disabled={false}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '应用修改并重新审核' }));
    expect(await screen.findByText('版本冲突')).toBeInTheDocument();
    expect(screen.getByText('本次修改 · 1 处')).toBeInTheDocument();
    expect(api.applyProseRevision).toHaveBeenCalledWith(
      'p',
      1,
      'r1',
      expect.objectContaining({ expectedRevision: 2, expectedHash: hash }),
    );
  });
  it('失败记录恢复时保留上一份成功预览和失败时的输入', () => {
    render(
      <ProseRevisionCard
        projectId="p"
        chapter={{
          ...chapter(),
          previousReadyRevision: ready(),
          activeRevision: {
            ...ready(),
            id: 'failed',
            status: 'failed',
            feedback: '新的要求',
            error: '模型失败',
          },
        }}
        disabled={false}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText('模型失败')).toBeInTheDocument();
    expect(screen.getByText('本次修改 · 1 处')).toBeInTheDocument();
    expect(screen.getByLabelText('补充修改建议（可独立填写）')).toHaveValue('新的要求');
    expect(screen.getByRole('button', { name: '应用修改并重新审核' })).toBeDisabled();
  });
  it('父级刷新任务失败时仍保留上一份成功预览', async () => {
    const view = render(
      <ProseRevisionCard
        projectId="p"
        chapter={{ ...chapter(), activeRevision: ready() }}
        disabled={false}
        onChanged={vi.fn()}
      />,
    );
    view.rerender(
      <ProseRevisionCard
        projectId="p"
        chapter={{ ...chapter(), activeRevision: { ...ready(), id: 'new', status: 'generating' } }}
        disabled={false}
        onChanged={vi.fn()}
      />,
    );
    expect(
      await screen.findByText('正在按所选建议生成修改预览，当前正文保留。'),
    ).toBeInTheDocument();
    view.rerender(
      <ProseRevisionCard
        projectId="p"
        chapter={{
          ...chapter(),
          activeRevision: { ...ready(), id: 'new', status: 'failed', error: '服务失败' },
        }}
        disabled={false}
        onChanged={vi.fn()}
      />,
    );
    expect(await screen.findByText('服务失败')).toBeInTheDocument();
    expect(screen.getByText('本次修改 · 1 处')).toBeInTheDocument();
  });
});
