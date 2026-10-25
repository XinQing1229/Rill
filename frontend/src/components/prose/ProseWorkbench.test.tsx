import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProseDetail } from '@rill/shared';
import { makeProject } from '../../test/fixtures';
import * as api from '../../api/novel';
import { ProseWorkbench } from './ProseWorkbench';
vi.mock('../../api/novel', () => ({
  getProse: vi.fn(),
  proseChapterAction: vi.fn(),
  createProseRevision: vi.fn(),
  getProseRevision: vi.fn(),
  applyProseRevision: vi.fn(),
  discardProseRevision: vi.fn(),
}));
const hash = 'a'.repeat(64);
function detail(): ProseDetail {
  return {
    directory: '/output/book',
    revision: 1,
    targetChapters: 1,
    acceptedChapters: 0,
    completed: false,
    blockingReason: null,
    chapters: [
      {
        chapterNumber: 1,
        path: '/output/book/chapters/001.md',
        content: '# 第一章\n\n<script>不能执行</script>',
        revision: 1,
        observedHash: hash,
        confirmedHash: null,
        generationStatus: 'done',
        reviewStatus: 'pending',
        fileStatus: 'valid',
        machineStep: 'human_accept',
        stale: false,
        error: null,
        candidates: [],
        report: {
          id: 'review',
          sourceHash: hash,
          dependencyFingerprint: hash,
          promptVersion: 'v1',
          coveredChapters: [],
          verdict: 'accept',
          overrideReason: null,
          scores: {
            consistency: 90,
            character: 90,
            pacing: 90,
            continuity: 90,
            foreshadow: 90,
            hook: 90,
            aesthetic: 90,
          },
          issues: [],
        },
        summary: {
          id: 'summary',
          reviewId: 'review',
          sourceHash: hash,
          dependencyFingerprint: hash,
          accepted: false,
          data: {
            events: ['收到信'],
            characterChanges: [],
            foreshadowing: [],
            continuity: '继续调查',
          },
        },
      },
    ],
  };
}
beforeEach(() => vi.resetAllMocks());
function show(d = detail()) {
  vi.mocked(api.getProse).mockResolvedValue(d);
  vi.mocked(api.proseChapterAction).mockResolvedValue(d);
  return render(
    <ProseWorkbench
      project={makeProject({ id: 'p', currentStage: 'prose', status: 'idle' })}
      busy={false}
      onGenerate={vi.fn()}
    />,
  );
}
describe('正文人工接受工作台', () => {
  it('本章和前文的多个片段分别展示，保留原文空白与来源章号', async () => {
    const d = detail();
    d.chapters[0].report!.issues = [
      {
        dimension: 'continuity',
        severity: 'warning',
        problem: '核对跨段因果',
        evidence: [' 第一处\n原文 ', '第二处原文'],
        location: '两段',
        basis: '原文',
        suggestion: '核对',
        previousEvidence: { chapterNumber: 1, quotes: ['前文第一处', '前文第二处'] },
      },
    ];
    const { container } = show(d);
    await screen.findByText('核对跨段因果');
    const blocks = [...container.querySelectorAll('blockquote')];
    expect(blocks.map((block) => block.textContent)).toEqual([
      ' 第一处\n原文 ',
      '第二处原文',
      '前文第一处',
      '前文第二处',
    ]);
    for (const block of blocks) expect(block).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(screen.getByText('第 1 章摘要：')).toBeInTheDocument();
  });
  it('展示待接受摘要、评分及安全正文，接受绑定版本和报告', async () => {
    const { container } = show();
    await screen.findByText('AI 审核 · accept');
    expect(screen.getByText('待接受摘要')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByRole('group', { name: '第 1 章创作进度' })).toBeInTheDocument();
    expect(container.querySelector('[aria-current="step"]')).toHaveTextContent('人工接受');
    fireEvent.click(screen.getByRole('button', { name: '接受本章并完成全书' }));
    await waitFor(() =>
      expect(api.proseChapterAction).toHaveBeenCalledWith('p', 1, 'confirm', {
        expectedRevision: 1,
        expectedHash: hash,
        reviewId: 'review',
        summaryId: 'summary',
      }),
    );
  });
  it('审核未通过时理由必填，保留原判后申请待接受摘要', async () => {
    const d = detail();
    d.chapters[0].summary = null;
    d.chapters[0].machineStep = 'summary';
    d.chapters[0].report!.verdict = 'rewrite';
    show(d);
    await screen.findByText('AI 审核 · rewrite');
    expect(screen.queryByRole('button', { name: '接受本章并完成全书' })).not.toBeInTheDocument();
    expect(document.querySelector('[aria-current="step"]')).toHaveTextContent('AI 审核');
    fireEvent.click(screen.getByRole('button', { name: '填写理由，保留当前正文' }));
    const button = screen.getByRole('button', { name: '保留原判并生成摘要' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('保留原判并继续生成摘要的理由'), {
      target: { value: '作者有意安排' },
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.proseChapterAction).toHaveBeenCalledWith(
        'p',
        1,
        'override',
        expect.objectContaining({ reason: '作者有意安排', reviewId: 'review' }),
      ),
    );
  });
  it('历史候选不再显示，仍可查看正文和接受摘要', async () => {
    const d = detail();
    d.chapters[0].candidates = [
      {
        operationId: 'candidate',
        path: '/output/book/candidates/1.md',
        content: '',
        sourceHash: hash,
        fileStatus: 'missing',
        error: '候选稿文件已删除或移动，正文和审核仍可正常使用',
      },
    ];
    show(d);
    await screen.findByText('AI 审核 · accept');
    expect(screen.queryByText('候选稿 · 与上方原文对比后在本地合并')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '接受本章并完成全书' })).not.toBeDisabled();
    expect(screen.getByText('待接受摘要')).toBeInTheDocument();
  });
  it('摘要失败只重试摘要，未出现候选与接受的并列主操作', async () => {
    const d = detail();
    d.chapters[0].summary = null;
    d.chapters[0].machineStep = 'summary';
    d.chapters[0].error = '摘要服务暂时不可用';
    show(d);
    fireEvent.click(await screen.findByRole('button', { name: '重试生成摘要' }));
    await waitFor(() => expect(api.proseChapterAction).toHaveBeenCalledWith('p', 1, 'retry', {}));
    expect(screen.queryByRole('button', { name: '生成候选稿' })).not.toBeInTheDocument();
  });
  it('审核待处理时定位到按建议修改，不调用旧的审核或候选操作', async () => {
    const d = detail();
    d.chapters[0].report!.verdict = 'polish';
    d.chapters[0].summary = null;
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    show(d);
    fireEvent.click(await screen.findByRole('button', { name: '按建议修改' }));
    expect(scroll).toHaveBeenCalled();
    expect(screen.getByLabelText('补充修改建议（可独立填写）')).toHaveFocus();
    expect(api.proseChapterAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '刷新本地修改' })).not.toBeInTheDocument();
  });
  it('已有文件丢失时只检查文件，不生成或覆盖正文', async () => {
    const d = detail();
    Object.assign(d.chapters[0], { fileStatus: 'missing', machineStep: 'generate', content: null });
    show(d);
    fireEvent.click(await screen.findByRole('button', { name: '重新检查文件' }));
    await waitFor(() => expect(api.getProse).toHaveBeenCalledTimes(2));
    expect(api.proseChapterAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '更多操作 ▾' })).not.toBeInTheDocument();
  });
  it('首次进入选择最早待处理章，查看后章时返回前文', async () => {
    const d = detail();
    d.targetChapters = 2;
    d.chapters.push({
      ...structuredClone(d.chapters[0]),
      chapterNumber: 2,
      fileStatus: 'missing',
      content: null,
      observedHash: null,
      report: null,
      summary: null,
      machineStep: 'generate',
      generationStatus: 'pending',
    });
    const { container } = show(d);
    await screen.findByRole('button', { name: '接受本章并生成下一章' });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '选择正文章节' }));
    fireEvent.click(
      await screen.findByText('第 2 章 · 待处理', { selector: '.ant-select-item-option-content' }),
    );
    expect(screen.getByRole('button', { name: '前往第 1 章' })).toBeInTheDocument();
    expect(container.querySelector('[aria-current="step"]')).toHaveTextContent('生成正文');
    fireEvent.click(screen.getByRole('button', { name: '前往第 1 章' }));
    expect(screen.getByRole('button', { name: '接受本章并生成下一章' })).toBeInTheDocument();
    expect(api.proseChapterAction).not.toHaveBeenCalled();
  });
  it('接受成功但后续失败时保留接受结果并定位失败章', async () => {
    const d = detail();
    d.targetChapters = 2;
    const later = {
      ...structuredClone(d.chapters[0]),
      chapterNumber: 2,
      report: null,
      summary: null,
      machineStep: 'ai_review' as const,
    };
    d.chapters.push(later);
    show(d);
    await screen.findByRole('button', { name: '接受本章并继续复核' });
    const updated = structuredClone(d);
    updated.chapters[0].machineStep = 'done';
    updated.chapters[0].reviewStatus = 'confirmed';
    updated.chapters[0].summary!.accepted = true;
    updated.acceptedChapters = 1;
    updated.chapters[1].error = '审核超时';
    vi.mocked(api.getProse).mockResolvedValue(updated);
    vi.mocked(api.proseChapterAction).mockRejectedValue(new Error('审核超时'));
    fireEvent.click(screen.getByRole('button', { name: '接受本章并继续复核' }));
    expect(await screen.findByText('第 1 章已接受；后续处理未完成：审核超时')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '第 2 章创作进度' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试 AI 审核' })).toBeInTheDocument();
  });
  it('操作期间防重复提交，执行目标不随浏览章节改变', async () => {
    show();
    const button = await screen.findByRole('button', { name: '接受本章并完成全书' });
    let resolve!: (value: ProseDetail) => void;
    vi.mocked(api.proseChapterAction).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.proseChapterAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText('第 1 章：正在接受并继续')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成修改预览' })).toBeDisabled();
    resolve(detail());
    await waitFor(() => expect(button).not.toBeDisabled());
  });
  it('初次读取失败可重新加载恢复', async () => {
    vi.mocked(api.getProse)
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValue(detail());
    render(
      <ProseWorkbench
        project={makeProject({ id: 'p', currentStage: 'prose', status: 'idle' })}
        busy={false}
        onGenerate={vi.fn()}
      />,
    );
    await screen.findByText('状态暂时无法更新：网络中断');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByRole('button', { name: '接受本章并完成全书' })).not.toBeDisabled();
  });
  it('没有章节记录时显示首次生成步骤，自动模式也不跳过人工接受', async () => {
    const d = detail();
    d.chapters = [];
    const generate = vi.fn();
    vi.mocked(api.getProse).mockResolvedValue(d);
    render(
      <ProseWorkbench
        project={makeProject({ currentStage: 'prose', mode: 'auto' })}
        busy={false}
        onGenerate={generate}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '生成本章正文' }));
    await waitFor(() => expect(generate).toHaveBeenCalledWith(false));
    expect(api.proseChapterAction).not.toHaveBeenCalled();
  });
  it('全书完成后没有接受主按钮，已接受节点显示完成', async () => {
    const d = detail();
    d.chapters[0].machineStep = 'done';
    d.chapters[0].reviewStatus = 'confirmed';
    d.chapters[0].summary!.accepted = true;
    d.acceptedChapters = 1;
    d.completed = true;
    const { container } = show(d);
    await screen.findByText('全书正文已接受。');
    expect(container.querySelector('[aria-current="step"]')).toHaveTextContent('已接受');
    expect(screen.queryByRole('button', { name: '接受本章并完成全书' })).not.toBeInTheDocument();
  });
  it('已知上游失效时阻止接受与候选生成，提示原因', async () => {
    const d = detail();
    vi.mocked(api.getProse).mockResolvedValue(d);
    render(
      <ProseWorkbench
        project={makeProject({
          currentStage: 'prose',
          stageStates: { outline: { status: 'done', stale: true, error: null, confirmedAt: null } },
        })}
        busy={false}
        onGenerate={vi.fn()}
      />,
    );
    await screen.findByText('大纲未确认或已失效，请先返回相应阶段处理。');
    expect(screen.getByRole('button', { name: '接受本章并完成全书' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成修改预览' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '刷新本地修改' })).not.toBeInTheDocument();
  });
});
