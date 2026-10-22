import { useMemo, useState } from 'react';
import { Alert, App, Button, Segmented, Skeleton } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { STAGE_LABELS, type PipelineMode, type Stage } from '@rill/shared';
import { ApiError } from '../api/client';
import { confirmStage, generateStage, parseAnswers, rollbackStage, setMode } from '../api/novel';
import { StageTimeline } from '../components/pipeline/StageTimeline';
import { StagePanel } from '../components/pipeline/StagePanel';
import { StatusTag } from '../components/StatusTag';
import { useProject } from '../hooks/useProject';
import { chosenDimensionsLabel, isImplementedStage, readStageState } from '../lib/stage';

const backArrow = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9.5 3.5 5 8l4.5 4.5" />
  </svg>
);

/** 工作台回答的问题：「我的小说进行到哪个阶段、下一步做什么？」 */
export function ProjectWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { project, error, loading, refresh, restartPolling } = useProject(id);
  const { message } = App.useApp();
  const [viewedStage, setViewedStage] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);

  const answers = useMemo(() => {
    if (!project) return null;
    try {
      return parseAnswers(project);
    } catch {
      return null;
    }
  }, [project]);

  const runAction = async (action: () => Promise<unknown>, successMessage?: string) => {
    setBusy(true);
    // 动作执行期间保持轮询：确认会触发生成下一阶段，进度需实时反映
    restartPolling();
    try {
      await action();
      await refresh();
      restartPolling();
      if (successMessage) message.success(successMessage);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        message.warning('正在生成中，请稍候');
        await refresh();
        restartPolling();
      } else {
        message.error(e instanceof Error ? e.message : '操作失败');
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading && project === null) {
    return (
      <div className="page" aria-busy="true">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="page">
        <Alert
          type="error"
          showIcon
          message={error ?? '项目不存在'}
          action={
            <Link to="/">
              <Button size="small">返回项目列表</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const stage = viewedStage ?? project.currentStage;
  const currentState = readStageState(project, project.currentStage);
  const currentImplemented = isImplementedStage(project.currentStage);
  const canConfirm =
    project.mode === 'manual' &&
    currentImplemented &&
    currentState?.status === 'done' &&
    !currentState.stale;

  const handleModeChange = (mode: PipelineMode) => {
    if (mode === project.mode) return;
    void runAction(
      () => setMode(project.id, mode),
      mode === 'auto' ? '已切换为自动推进' : '已切换为手动推进',
    );
  };

  return (
    <div>
      <div className="builder-bar">
        <Link to="/" className="back" aria-label="返回项目">
          {backArrow}
        </Link>
        <h1>{project.title}</h1>
        <StatusTag status={project.status} />
        {project.status === 'failed' && (
          <span className="hint">上次生成失败，可在对应阶段重试</span>
        )}
        <div className="right">
          <Segmented
            value={project.mode}
            onChange={(value) => handleModeChange(value as PipelineMode)}
            options={[
              { label: '手动', value: 'manual' },
              { label: '自动', value: 'auto' },
            ]}
          />
          {canConfirm && (
            <Button type="primary" loading={busy} onClick={() => handleConfirm()}>
              确认并推进
            </Button>
          )}
        </div>
      </div>

      <div className="page">
        {answers !== null && (
          <div className="sub" style={{ marginBottom: 16 }}>
            问卷已选维度（只读）：{chosenDimensionsLabel(answers)}
          </div>
        )}
        <div className="work">
          <StageTimeline
            project={project}
            viewedStage={viewedStage}
            onSelect={setViewedStage}
            advance={
              currentImplemented && project.currentStage === 'characters' && canConfirm
                ? { disabled: busy, onClick: () => handleConfirm() }
                : undefined
            }
          />
          <div className="canvas-well">
            <StagePanel
              project={project}
              stage={stage}
              busy={busy}
              onGenerate={(force) =>
                void runAction(
                  () => generateStage(project.id, force ? { force: true } : {}),
                  undefined,
                )
              }
              onConfirm={() => handleConfirm()}
              onRollback={(target) =>
                void runAction(
                  () => rollbackStage(project.id, target),
                  `已回退到「${STAGE_LABELS[target]}」，其后阶段产物标记为失效`,
                )
              }
            />
          </div>
        </div>
      </div>
    </div>
  );

  function handleConfirm() {
    void runAction(() => confirmStage(project!.id), '已确认，正在生成下一阶段');
  }
}
