import type { ProseChapterDetail, ProseDetail, ProjectDetail } from '@rill/shared';

export const PROSE_STEPS = ['生成正文', 'AI 审核', '生成摘要', '人工接受', '已接受'];
export type ProseAction =
  'generate' | 'retry' | 'revise' | 'confirm' | 'refresh' | 'restore' | 'navigate';

export function isAccepted(chapter: ProseChapterDetail) {
  return chapter.machineStep === 'done' && !chapter.stale && chapter.fileStatus === 'valid';
}

export function nextChapter(detail: ProseDetail) {
  return [...detail.chapters]
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .find((c) => !isAccepted(c));
}

/** 后端 machineStep 是恢复位置；未放行的审核意见要优先展示在审核节点。 */
export function proseUiState(detail: ProseDetail, chapter: ProseChapterDetail | undefined) {
  const earliest = nextChapter(detail);
  const initial =
    !chapter ||
    (chapter.fileStatus === 'missing' &&
      !chapter.observedHash &&
      chapter.generationStatus === 'pending');
  const fileBlocked = Boolean(chapter && chapter.fileStatus !== 'valid' && !initial);
  const reviewBlocked = Boolean(
    chapter &&
    !chapter.stale &&
    chapter.report &&
    chapter.report.verdict !== 'accept' &&
    !chapter.report.overrideReason,
  );
  const step =
    !chapter || chapter.fileStatus !== 'valid'
      ? 0
      : isAccepted(chapter)
        ? 4
        : chapter.stale || !chapter.report || reviewBlocked
          ? 1
          : !chapter.summary
            ? 2
            : 3;
  let action: ProseAction = 'retry';
  let label = '';
  let description = '';
  if (fileBlocked) {
    action = chapter?.canRestore ? 'restore' : 'refresh';
    label = chapter?.canRestore ? '恢复已保存正文' : '重新检查文件';
    description = `第 ${chapter!.chapterNumber} 章文件异常，请恢复已保存的正文后重新检查。`;
  } else if (chapter && earliest && chapter.chapterNumber !== earliest.chapterNumber) {
    action = 'navigate';
    label = isAccepted(chapter) ? '前往当前待处理章节' : `前往第 ${earliest.chapterNumber} 章`;
    description = `请先处理第 ${earliest.chapterNumber} 章；当前可继续阅读所选章节。`;
  } else if (step === 4) {
    action = 'navigate';
    label = '';
    description = '全书正文已接受。';
  } else if (initial) {
    action = 'generate';
    label = chapter?.error ? '重试生成正文' : '生成本章正文';
    description = '将依次生成本章正文、进行 AI 审核并生成摘要，最后等待你接受。';
  } else if (reviewBlocked) {
    action = 'revise';
    label = '按建议修改';
    description =
      '请选择要执行的审核建议或填写自己的要求，预览后应用修改；也可填写理由保留当前正文。';
  } else if (step === 1) {
    label = chapter?.error ? '重试 AI 审核' : '审核本章';
    description =
      chapter?.reviewStatus === 'needs_review' || chapter?.stale
        ? '本章需复核，将使用最新前文重新审核，保留当前正文。'
        : '审核当前正文，通过后自动生成摘要。';
  } else if (step === 2) {
    label = chapter?.error ? '重试生成摘要' : '生成本章摘要';
    description = '复用当前有效审核报告，从实际正文提取待接受摘要。';
  } else {
    action = 'confirm';
    const following = detail.chapters.find(
      (c) => c.chapterNumber > chapter!.chapterNumber && !isAccepted(c),
    );
    const last = !following && chapter!.chapterNumber === detail.targetChapters;
    const review = following?.fileStatus === 'valid';
    label = last ? '接受本章并完成全书' : review ? '接受本章并继续复核' : '接受本章并生成下一章';
    description = `请检查当前正文、AI 审核报告和摘要。${last ? '接受后完成正文阶段。' : review ? '接受后继续复核后文章节。' : `接受后将生成第 ${chapter!.chapterNumber + 1} 章。`}`;
  }
  return { step, action, label, description, initial, fileBlocked, reviewBlocked, earliest };
}

/** 缺少进度信息时交由服务端门禁判断；已知失效不能继续提交。 */
export function proseUpstreamBlock(project: ProjectDetail) {
  for (const stage of ['outline'] as const) {
    const progress = project.outlineProgress;
    const state = project.stageStates?.[stage];
    if (
      (progress && (progress.stale || progress.confirmedRevision !== progress.revision)) ||
      state?.stale
    ) {
      return `大纲未确认或已失效，请先返回相应阶段处理。`;
    }
  }
  return null;
}
