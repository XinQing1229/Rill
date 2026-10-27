import { PremiseChangeSummaryView } from './PremiseChangeSummaryView';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { EditOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Popconfirm, Space } from 'antd';
import { STAGE_LABELS, type PremisePreview, type ProjectDetail } from '@rill/shared';
import { adoptPremise, previewPremise } from '../../api/novel';
import { PremiseView } from './PremiseView';
import { readStageState } from '../../lib/stage';

interface Props {
  actions?: ReactNode;
  project: ProjectDetail;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged?: () => void | Promise<unknown>;
}

/** 正式种子与候选分开展示，失败时保留输入和最后一次成功预览。 */
export function PremiseRevisionCard({ project, busy, onBusyChange, onChanged, actions }: Props) {
  const labelId = useId();
  const [feedback, setFeedback] = useState('');
  const [preview, setPreview] = useState<PremisePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'preview' | 'adopt' | null>(null);
  const active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const disabled = busy || project.status === 'running' || pending !== null;
  const affected = project.stages
    .filter(
      (stage) =>
        stage !== 'premise' &&
        readStageState(project, stage)?.status !== 'pending' &&
        readStageState(project, stage),
    )
    .map((stage) => STAGE_LABELS[stage]);

  async function submit(kind: 'preview' | 'adopt') {
    if (active.current || disabled) return;
    if (kind === 'preview' && !feedback.trim()) {
      setError('请填写修改建议');
      return;
    }
    active.current = true;
    setPending(kind);
    onBusyChange(true);
    setError(null);
    try {
      if (kind === 'preview') {
        const result = await previewPremise(project.id, {
          requestId: crypto.randomUUID(),
          feedback: feedback.trim(),
        });
        if (mounted.current) setPreview(result);
      } else if (preview) {
        await adoptPremise(project.id, preview.candidateId);
        if (mounted.current) setPreview(null);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : '操作失败，请重试');
    } finally {
      active.current = false;
      onBusyChange(false);
      if (mounted.current) {
        setPending(null);
        await onChanged?.();
      }
    }
  }

  return (
    <section
      className="pv-card pv-revision"
      aria-labelledby={`${labelId}-heading`}
      aria-busy={pending !== null}
    >
      <div className="pv-card-head">
        <EditOutlined className="pv-section-icon" aria-hidden="true" />
        <h2 id={`${labelId}-heading`} className="pv-title">
          按建议修改
        </h2>
        <span className="pv-hint">先预览，再决定是否采用</span>
        {actions}
      </div>
      <label htmlFor={labelId}>修改建议</label>
      <Input.TextArea
        id={labelId}
        value={feedback}
        maxLength={2000}
        showCount
        rows={4}
        disabled={disabled}
        onChange={(event) => setFeedback(event.target.value)}
        placeholder="例如：保留主角身份，加强核心冲突，减少巧合。"
      />
      <p className="hint" style={{ marginTop: 20 }}>
        每次根据当前正式种子和本次建议生成完整候选，采用前不会影响正式内容或创作进度。
      </p>
      {project.status === 'running' && (
        <p role="status">项目正在运行，暂不能生成预览或采用修改。</p>
      )}
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Button
        type="primary"
        disabled={disabled}
        loading={pending === 'preview'}
        onClick={() => void submit('preview')}
      >
        {preview ? '重新生成修改预览' : '生成修改预览'}
      </Button>
      {preview && (
        <div style={{ marginTop: 24 }}>
          <PremiseChangeSummaryView
            key={preview.candidateId}
            summary={preview.changeSummary ?? null}
            warning={preview.changeSummaryWarning}
          />
          <h3>候选种子（尚未采用）</h3>
          <p>暂定书名：{preview.premise.title}</p>
          <PremiseView premise={preview.premise} />
          <Space style={{ marginTop: 16 }}>
            <Popconfirm
              title="采用修改并回到种子待确认？"
              description={
                affected.length
                  ? `以下已有内容将失效，需要重新生成：${affected.join('、')}。`
                  : '正式种子将被替换，采用后等待你确认再继续。'
              }
              disabled={disabled}
              okText="确认采用"
              cancelText="取消"
              onConfirm={() => submit('adopt')}
            >
              <Button type="primary" disabled={disabled} loading={pending === 'adopt'}>
                采用修改
              </Button>
            </Popconfirm>
            <Button disabled={disabled} onClick={() => setPreview(null)}>
              放弃
            </Button>
          </Space>
        </div>
      )}
    </section>
  );
}
