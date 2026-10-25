import { ProseRevisionCard } from './ProseRevisionCard';
import { ChapterCopy } from '../book-export/ChapterCopy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Spin, Tag, Typography } from 'antd';
import { ArrowUpOutlined } from '@ant-design/icons';
import { PROSE_REVIEW_DIMENSIONS, type ProseDetail, type ProjectDetail } from '@rill/shared';
import { getProse, proseChapterAction } from '../../api/novel';
import { ProseChapterSteps } from './ProseChapterSteps';
import { ProseChapterActions } from './ProseChapterActions';
import { isAccepted, nextChapter, proseUiState, proseUpstreamBlock } from './prose-ui-state';
import './ProseWorkbench.css';

/** 仅渲染文本和 Markdown 标题/段落，不解释 HTML 或可执行链接。 */
function MarkdownText({ content }: { content: string }) {
  return (
    <article aria-label="章节正文" style={{ lineHeight: 1.9, overflowWrap: 'anywhere' }}>
      {content.split(/\n\s*\n/).map((paragraph, index) =>
        paragraph.startsWith('# ') ? (
          <h3 key={index}>{paragraph.slice(2)}</h3>
        ) : (
          <p key={index} style={{ whiteSpace: 'pre-wrap' }}>
            {paragraph}
          </p>
        ),
      )}
    </article>
  );
}
const fileLabels: Record<string, string> = {
  valid: '文件正常',
  missing: '文件缺失',
  empty: '正文为空',
  invalid_encoding: '编码错误',
  unreadable: '暂时无法读取',
};
const dimensionLabels: Record<string, string> = {
  consistency: '设定一致性',
  character: '人设一致性',
  pacing: '节奏平衡',
  continuity: '叙事连贯',
  foreshadow: '伏笔',
  hook: '钩子',
  aesthetic: '审美品质',
};
export function ProseWorkbench({
  project,
  busy,
  onGenerate,
  onChanged,
}: {
  project: ProjectDetail;
  busy: boolean;
  onGenerate: (force: boolean) => void | Promise<void>;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<ProseDetail | null>(null);
  const [selected, setSelected] = useState(1);
  const selectedRef = useRef(1);
  const initialized = useRef(false);
  const request = useRef(0);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [activity, setActivity] = useState('');
  const [reason, setReason] = useState('');
  const [showReason, setShowReason] = useState(false);
  const choose = (number: number) => {
    selectedRef.current = number;
    setSelected(number);
  };
  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const data = await getProse(project.id);
      if (sequence === request.current) {
        setDetail(data);
        setReadError(null);
        if (!initialized.current) {
          const number =
            nextChapter(data)?.chapterNumber ?? data.chapters.at(-1)?.chapterNumber ?? 1;
          initialized.current = true;
          selectedRef.current = number;
          setSelected(number);
        }
      }
      return data;
    } catch (e) {
      if (sequence === request.current)
        setReadError(e instanceof Error ? e.message : '读取正文失败');
      return null;
    }
  }, [project.id]);
  useEffect(() => {
    void refresh();
  }, [refresh, project.status]);
  useEffect(() => {
    if (project.status !== 'running' && !working) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [project.status, working, refresh]);
  const revisionChanged = useCallback(() => {
    void refresh();
    onChanged?.();
  }, [refresh, onChanged]);
  const chapter = detail?.chapters.find((c) => c.chapterNumber === selected);
  const ui = detail ? proseUiState(detail, chapter) : null;
  const upstreamBlock = proseUpstreamBlock(project);
  const running = busy || working || project.status === 'running';
  const blocked =
    running || Boolean(readError) || Boolean(upstreamBlock) || project.currentStage !== 'prose';
  const earliest = ui?.earliest?.chapterNumber;
  useEffect(() => {
    setReason('');
    setShowReason(false);
  }, [selected, chapter?.report?.id]);

  const advanceSelection = (data: ProseDetail, number: number) => {
    if (!data.chapters.some((c) => c.chapterNumber === number && isAccepted(c))) return false;
    const next = nextChapter(data);
    if (next && selectedRef.current === number) choose(next.chapterNumber);
    return true;
  };
  const action = async (name: 'retry' | 'override' | 'confirm' | 'restore') => {
    if (!chapter || blocked || lock.current) return;
    lock.current = true;
    setWorking(true);
    setError(null);
    setNotice(null);
    const number = chapter.chapterNumber;
    setActivity(
      `第 ${number} 章：${name === 'confirm' ? '正在接受并继续' : name === 'override' ? '正在保存理由并生成摘要' : '正在处理审核 / 摘要'}`,
    );
    try {
      const version = { expectedRevision: chapter.revision, expectedHash: chapter.observedHash };
      const body =
        name === 'override'
          ? { ...version, reviewId: chapter.report?.id, reason: reason.trim() }
          : name === 'confirm'
            ? { ...version, reviewId: chapter.report?.id, summaryId: chapter.summary?.id }
            : {};
      onChanged?.();
      const data = await proseChapterAction(project.id, number, name, body);
      request.current++;
      setDetail(data);
      setReadError(null);
      if (name === 'confirm') {
        advanceSelection(data, number);
        setNotice(
          data.completed ? '全书正文已接受。' : `第 ${number} 章已接受，正在继续处理后文章节。`,
        );
      }
      setReason('');
      setShowReason(false);
    } catch (e) {
      const data = await refresh();
      const accepted = name === 'confirm' && data && advanceSelection(data, number);
      const message = e instanceof Error ? e.message : '正文操作失败';
      setError(accepted ? `第 ${number} 章已接受；后续处理未完成：${message}` : message);
    } finally {
      lock.current = false;
      setWorking(false);
      setActivity('');
      onChanged?.();
    }
  };
  const primary = async () => {
    if (!ui || lock.current) return;
    if (ui.action === 'navigate') {
      if (earliest) choose(earliest);
    } else if (ui.action === 'revise') {
      document
        .getElementById('prose-revision')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById(`prose-feedback-${selected}`)?.focus();
    } else if (ui.action === 'refresh') {
      await refresh();
    } else if (ui.action === 'generate') {
      if (blocked) return;
      lock.current = true;
      setWorking(true);
      setError(null);
      setNotice(null);
      setActivity(`第 ${selected} 章：正在生成正文并继续机器步骤`);
      try {
        await onGenerate(false);
        await refresh();
      } catch (e) {
        await refresh();
        setError(e instanceof Error ? e.message : '正文生成失败');
      } finally {
        lock.current = false;
        setWorking(false);
        setActivity('');
      }
    } else {
      await action(
        ui.action === 'confirm' ? 'confirm' : ui.action === 'restore' ? 'restore' : 'retry',
      );
    }
  };
  const primaryDisabled =
    ui?.action === 'navigate' ? false : ui?.action === 'refresh' ? running : blocked;
  const disabledReason = readError
    ? '状态暂时无法更新，请重新加载后再操作。'
    : (upstreamBlock ?? (project.currentStage !== 'prose' ? '请先推进项目到正文阶段。' : null));
  return (
    <section className="node" aria-label="正文工作台">
      <header>
        <h2>正文</h2>
      </header>
      <p className="prose-help">
        选择 AI 审核建议或填写修改要求，预览实际改动后应用，重新审核并人工接受。
      </p>
      <div className="prose-toolbar">
        <Typography.Text>
          全书已接受 {detail?.acceptedChapters ?? 0} / {detail?.targetChapters ?? '—'} 章
        </Typography.Text>
        {detail && detail.chapters.length > 0 && (
          <Select
            aria-label="选择正文章节"
            value={selected}
            onChange={choose}
            options={detail.chapters.map((c) => ({
              value: c.chapterNumber,
              label: `第 ${c.chapterNumber} 章 · ${isAccepted(c) ? '已接受' : c.reviewStatus === 'needs_review' || c.stale ? '需复核' : '待处理'}`,
            }))}
          />
        )}
        {earliest && selected !== earliest && (
          <Button onClick={() => choose(earliest)}>返回当前待处理章节</Button>
        )}
      </div>
      {!detail && !readError && <Spin />}
      {ui && (
        <>
          <ProseChapterSteps
            number={selected}
            step={ui.step}
            failed={Boolean(ui.fileBlocked || (ui.step < 3 && chapter?.error && !ui.reviewBlocked))}
            reviewBlocked={ui.reviewBlocked}
            overridden={Boolean(chapter?.report?.overrideReason)}
          />
          <div className="prose-control" id="prose-chapter-actions">
            <div role="status" aria-live="polite">
              <strong>
                {ui.reviewBlocked
                  ? '审核意见待处理'
                  : ui.step === 4
                    ? '已接受'
                    : `第 ${selected} 章 · ${ui.step === 3 ? '待人工接受' : '待处理'}`}
              </strong>
              <p>{ui.description}</p>
              {running && <p>{activity || '正在处理正文，请稍候；可继续阅读和切换章节。'}</p>}
              {notice && <p>{notice}</p>}
            </div>
            {disabledReason && <Alert type="warning" showIcon message={disabledReason} />}
            {(error || chapter?.error) && (
              <Alert role="alert" type="error" showIcon message={error ?? chapter?.error} />
            )}
            <ChapterCopy projectId={project.id} chapterNumber={selected} />
            <ProseChapterActions
              label={ui.label}
              disabled={primaryDisabled}
              loading={working}
              onPrimary={() => void primary()}
            />
          </div>
        </>
      )}
      {readError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message={`状态暂时无法更新：${readError}`}
          action={<Button onClick={() => void refresh()}>重新加载</Button>}
        />
      )}
      {!detail && error && <Alert role="alert" type="error" message={error} />}
      {chapter && (
        <>
          <Tag>{fileLabels[chapter.fileStatus]}</Tag>
          <MarkdownText content={chapter.content ?? '本章尚无可读取的正文。'} />
          {chapter.report && (
            <Card title={`AI 审核 · ${chapter.report.verdict}`}>
              <Space wrap>
                {PROSE_REVIEW_DIMENSIONS.map((d) => (
                  <Tag key={d}>
                    {dimensionLabels[d]}：{chapter.report!.scores[d]}
                  </Tag>
                ))}
              </Space>
              {chapter.report.issues.map((issue, i) => (
                <Card
                  key={i}
                  size="small"
                  title={`${issue.severity} · ${dimensionLabels[issue.dimension]}`}
                  style={{ marginTop: 12 }}
                >
                  <p>{issue.problem}</p>
                  {issue.evidence.map((quote, index) => (
                    <blockquote key={index} style={{ whiteSpace: 'pre-wrap' }}>
                      {quote}
                    </blockquote>
                  ))}
                  <p>位置：{issue.location}</p>
                  <p>依据：{issue.basis}</p>
                  <p>建议：{issue.suggestion}</p>
                  {issue.previousEvidence && (
                    <div>
                      <p>第 {issue.previousEvidence.chapterNumber} 章摘要：</p>
                      {issue.previousEvidence.quotes.map((quote, index) => (
                        <blockquote key={index} style={{ whiteSpace: 'pre-wrap' }}>
                          {quote}
                        </blockquote>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
              {chapter.report.overrideReason && (
                <p>作者覆盖理由：{chapter.report.overrideReason}</p>
              )}
              {!chapter.stale &&
                chapter.report.verdict !== 'accept' &&
                !chapter.report.overrideReason && (
                  <div style={{ marginTop: 16 }}>
                    <Button
                      disabled={blocked || selected !== earliest || ui?.fileBlocked}
                      onClick={() => setShowReason((value) => !value)}
                    >
                      填写理由，保留当前正文
                    </Button>
                    {showReason && (
                      <div className="prose-override">
                        <label htmlFor="prose-override-reason">保留原判并继续生成摘要的理由</label>
                        <Input.TextArea
                          id="prose-override-reason"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          disabled={running}
                        />
                        {!reason.trim() && <p>请填写非空理由后提交；生成摘要后仍需人工接受。</p>}
                        <Button
                          disabled={
                            blocked || selected !== earliest || !reason.trim() || ui?.fileBlocked
                          }
                          onClick={() => void action('override')}
                        >
                          保留原判并生成摘要
                        </Button>
                      </div>
                    )}
                  </div>
                )}
            </Card>
          )}
          {chapter.fileStatus === 'valid' && (
            <ProseRevisionCard
              key={`${project.id}-${selected}`}
              projectId={project.id}
              chapter={chapter}
              disabled={blocked || Boolean(earliest && selected > earliest)}
              onChanged={revisionChanged}
            />
          )}
          {chapter.summary && (
            <Card
              title={chapter.summary.accepted ? '已接受摘要' : '待接受摘要'}
              style={{ marginTop: 16 }}
            >
              <div className="prose-summary">
                {(
                  [
                    ['events', '关键事件', '本章暂无关键事件'],
                    ['characterChanges', '人物变化', '本章暂无人物变化'],
                    ['foreshadowing', '伏笔线索', '本章暂无伏笔线索'],
                  ] as const
                ).map(([key, label, emptyText]) => {
                  const items = chapter.summary!.data[key];
                  return (
                    <section key={key} aria-label={label} className="prose-summary-section">
                      <div className="prose-summary-heading">
                        <Typography.Title level={3}>{label}</Typography.Title>
                        <Typography.Text type="secondary">{items.length} 项</Typography.Text>
                      </div>
                      {items.length > 0 ? (
                        key === 'events' ? (
                          <ol className="prose-summary-list">
                            {items.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ol>
                        ) : (
                          <ul className="prose-summary-list">
                            {items.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        )
                      ) : (
                        <Typography.Paragraph type="secondary">{emptyText}</Typography.Paragraph>
                      )}
                    </section>
                  );
                })}
                <section aria-label="连贯性说明" className="prose-summary-section">
                  <div className="prose-summary-heading">
                    <Typography.Title level={3}>连贯性说明</Typography.Title>
                  </div>
                  <Typography.Paragraph className="prose-summary-continuity">
                    {chapter.summary.data.continuity}
                  </Typography.Paragraph>
                </section>
              </div>
            </Card>
          )}
        </>
      )}
      {chapter?.summary && (
        <div className="prose-footer-actions">
          <Button
            className="prose-return-button"
            href="#prose-chapter-actions"
            icon={<ArrowUpOutlined aria-hidden="true" />}
          >
            返回本章操作区
          </Button>
        </div>
      )}
    </section>
  );
}
