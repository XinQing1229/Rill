import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Input, Space } from 'antd';
import type { ProseChapterDetail, ProseRevision } from '@rill/shared';
import {
  createProseRevision,
  getProseRevision,
  applyProseRevision,
  discardProseRevision,
} from '../../api/novel';

function readDraft(
  key: string,
): { feedback: string; indexes: number[]; reportId: string | null } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return value &&
      typeof value.feedback === 'string' &&
      Array.isArray(value.indexes) &&
      value.indexes.every((n: unknown) => Number.isInteger(n))
      ? value
      : null;
  } catch {
    return null;
  }
}

export function ProseRevisionCard({
  projectId,
  chapter,
  disabled,
  onChanged,
}: {
  projectId: string;
  chapter: ProseChapterDetail;
  disabled: boolean;
  onChanged: () => void;
}) {
  const initial = chapter.activeRevision;
  const draftKey = `rill-prose-feedback:${projectId}:${chapter.chapterNumber}`;
  const [draft] = useState(() => readDraft(draftKey));
  const fallback = chapter.previousReadyRevision ?? null;
  const recoverableFailure = initial && ['failed', 'blocked', 'unchanged'].includes(initial.status);
  const [feedback, setFeedback] = useState(draft?.feedback ?? initial?.feedback ?? '');
  const [indexes, setIndexes] = useState<number[]>(
    draft
      ? draft.reportId === (chapter.report?.id ?? null)
        ? draft.indexes
        : []
      : initial?.reviewId === chapter.report?.id
        ? (initial?.suggestions.map((s) => s.issueIndex) ?? [])
        : [],
  );
  const [revision, setRevision] = useState<ProseRevision | null>(
    (recoverableFailure ? fallback : initial) ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(
    recoverableFailure ? (initial.error ?? initial.explanation) : null,
  );
  const previousReady = useRef<ProseRevision | null>(fallback);
  const lock = useRef(false);
  const mounted = useRef(true);
  const reportId = chapter.report?.id ?? null;
  const previousReport = useRef(reportId);
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ feedback, indexes, reportId }));
    } catch {
      /* 存储不可用时仍允许修改。 */
    }
  }, [draftKey, feedback, indexes, reportId]);
  useEffect(() => {
    if (revision?.status === 'ready') previousReady.current = revision;
  }, [revision]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (previousReport.current !== reportId) {
      setIndexes([]);
      previousReport.current = reportId;
    }
  }, [reportId]);
  useEffect(() => {
    const active = chapter.activeRevision;
    if (
      active &&
      (!revisionRef.current ||
        active.id === revisionRef.current.id ||
        active.status === 'generating' ||
        active.status === 'applying')
    ) {
      if (['failed', 'blocked', 'unchanged'].includes(active.status) && previousReady.current) {
        setRevision(previousReady.current);
        setError(active.error ?? active.explanation ?? '未生成新的修改结果，已保留上次预览');
      } else setRevision(active);
    }
  }, [chapter.activeRevision]);
  const pending = revision?.status === 'generating' || revision?.status === 'applying';
  useEffect(() => {
    if (!revision?.id || !pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await getProseRevision(projectId, chapter.chapterNumber, revision.id);
        if (stopped) return;
        if (['failed', 'blocked', 'unchanged'].includes(data.status) && previousReady.current) {
          setRevision(previousReady.current);
          setError(data.error ?? data.explanation ?? '未生成新的修改结果，已保留上次预览');
        } else {
          setRevision(data);
          setError(null);
        }
        if (data.status !== 'generating' && data.status !== 'applying') {
          onChanged();
          return;
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : '状态读取失败，正在重试');
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [revision?.id, pending, projectId, chapter.chapterNumber, onChanged]);
  const matches = Boolean(
    revision &&
    revision.feedback === feedback.trim() &&
    revision.reviewId === (indexes.length ? reportId : null) &&
    JSON.stringify(revision.suggestions.map((s) => s.issueIndex).sort((a, b) => a - b)) ===
      JSON.stringify([...indexes].sort((a, b) => a - b)),
  );
  const stale = Boolean(
    revision &&
    (revision.baseHash !== chapter.observedHash || revision.baseRevision !== chapter.revision),
  );
  const run = async (kind: 'generate' | 'apply' | 'discard') => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      let data: ProseRevision;
      if (kind === 'generate')
        data = await createProseRevision(projectId, chapter.chapterNumber, {
          requestId: crypto.randomUUID(),
          expectedRevision: chapter.revision,
          expectedHash: chapter.observedHash!,
          feedback: feedback.trim(),
          ...(indexes.length
            ? { reviewSelection: { reviewId: reportId!, issueIndexes: indexes } }
            : {}),
        });
      else if (kind === 'apply')
        data = await applyProseRevision(projectId, chapter.chapterNumber, revision!.id, {
          requestId: crypto.randomUUID(),
          expectedRevision: revision!.baseRevision,
          expectedHash: revision!.baseHash,
        });
      else data = await discardProseRevision(projectId, chapter.chapterNumber, revision!.id);
      if (mounted.current) {
        setRevision(data);
        onChanged();
      }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : '操作失败');
        onChanged();
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const locked = disabled || busy || pending;
  return (
    <Card
      title="按建议修改"
      id="prose-revision"
      style={{ marginTop: 16 }}
      aria-busy={busy || pending}
    >
      <p>选择本次要执行的审核建议，或填写自己的要求。未选建议不作为本次修改要求。</p>
      {chapter.report && !chapter.stale && chapter.report.issues.length > 0 && (
        <fieldset disabled={locked} className="prose-suggestions">
          <legend>采用哪些审核建议（可多选，默认不勾选）</legend>
          <Space wrap>
            <span>
              已选 {indexes.length} / {chapter.report.issues.length} 条
            </span>
            <Button
              aria-label="全选"
              disabled={locked}
              onClick={() => setIndexes(chapter.report!.issues.map((_, i) => i))}
            >
              全选
            </Button>
            <Button disabled={locked} onClick={() => setIndexes([])}>
              清空选择
            </Button>
          </Space>
          {chapter.report.issues.map((issue, i) => (
            <div key={`${reportId}-${i}`} style={{ marginTop: 12 }}>
              <Checkbox
                disabled={locked}
                checked={indexes.includes(i)}
                onChange={(e) =>
                  setIndexes((items) =>
                    e.target.checked ? [...items, i] : items.filter((n) => n !== i),
                  )
                }
              >
                建议 {i + 1} ·{' '}
                {{ warning: '建议优化', error: '需要修改', critical: '严重问题' }[issue.severity]} ·{' '}
                {issue.problem}：{issue.suggestion}
              </Checkbox>
              <details
                onToggle={(e) => {
                  const open = e.currentTarget.open;
                  setEvidenceOpen((items) =>
                    open ? [...new Set([...items, i])] : items.filter((n) => n !== i),
                  );
                }}
              >
                <summary>查看依据与原文</summary>
                <p>
                  {issue.location} · {issue.basis}
                </p>
                {evidenceOpen.includes(i) &&
                  issue.evidence.map((text, j) => (
                    <blockquote key={j} style={{ whiteSpace: 'pre-wrap' }}>
                      {text}
                    </blockquote>
                  ))}
              </details>
            </div>
          ))}
        </fieldset>
      )}
      <label htmlFor={`prose-feedback-${chapter.chapterNumber}`}>补充修改建议（可独立填写）</label>
      <Input.TextArea
        id={`prose-feedback-${chapter.chapterNumber}`}
        value={feedback}
        maxLength={2000}
        showCount
        autoSize={{ minRows: 3, maxRows: 8 }}
        disabled={locked}
        onChange={(e) => setFeedback(e.target.value)}
      />
      <p>
        仅修改本章，保留未涉及的情节与人物设定。应用后，第 {chapter.chapterNumber}{' '}
        章起需要重新审核确认，后文章节原文将保留。
      </p>
      {!feedback.trim() && !indexes.length && <p>请选择至少一条建议，或填写修改要求。</p>}
      <Button
        disabled={locked || (!feedback.trim() && !indexes.length)}
        loading={busy}
        onClick={() => void run('generate')}
      >
        生成修改预览
      </Button>
      {error && <Alert role="alert" type="error" message={error} style={{ marginTop: 12 }} />}
      {revision && (
        <div style={{ marginTop: 16 }} role="status" aria-live="polite">
          {pending && (
            <p>
              {revision.status === 'generating'
                ? '正在按所选建议生成修改预览，当前正文保留。'
                : '正在应用修改并重新审核，请稍候。'}
            </p>
          )}
          {revision.error && (
            <Alert
              type="warning"
              message={
                revision.status === 'applied'
                  ? `修改已应用，后续审核或摘要未完成：${revision.error}`
                  : revision.error
              }
            />
          )}
          {revision.status === 'blocked' && (
            <Alert type="warning" message={`修改要求存在冲突：${revision.explanation}`} />
          )}
          {revision.status === 'unchanged' && <p>未检测到正文变化，请补充更具体的建议。</p>}
          {revision.status === 'discarded' && <p>已放弃本次修改，正式正文保留。</p>}
          {revision.status === 'applied' && (
            <p>修改已应用；请检查最新审核和摘要，人工接受后再继续。</p>
          )}
          {revision.status === 'ready' && (
            <>
              <h3>本次修改 · {revision.changes.length} 处</h3>
              <p>
                本次所选建议：
                {revision.suggestions.length
                  ? revision.suggestions.map((s) => `建议 ${s.issueIndex + 1}`).join('、')
                  : '无'}
              </p>
              {revision.feedback && <p>补充要求：{revision.feedback}</p>}
              {revision.suggestionResponses.map((s) => (
                <p key={s.issueIndex}>
                  建议 {s.issueIndex + 1} · AI 处理说明：{s.explanation}
                </p>
              ))}
              <p>处理说明由 AI 提供，请结合实际差异核对。</p>
              <Collapse
                items={revision.changes.map((change, i) => ({
                  key: String(i),
                  label: `修改 ${i + 1} · 查看修改前后`,
                  children: (
                    <>
                      <h4>修改前</h4>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{change.before || '（无）'}</p>
                      <h4>修改后</h4>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{change.after || '（删除）'}</p>
                    </>
                  ),
                }))}
              />
              <details>
                <summary>查看修改后全文</summary>
                <article style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9 }}>
                  {revision.content}
                </article>
              </details>
              {(!matches || stale) && (
                <Alert type="warning" message="建议、正文或报告已变化，请重新生成修改预览。" />
              )}
              <Space wrap>
                <Button
                  type="primary"
                  disabled={locked || !matches || stale}
                  onClick={() => void run('apply')}
                >
                  应用修改并重新审核
                </Button>
                <Button disabled={locked} onClick={() => void run('discard')}>
                  放弃本次修改
                </Button>
              </Space>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
