import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Segmented, Skeleton } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { GENRE_LABELS, LENGTH_LABELS, STAGE_LABELS, type PipelineMode } from '@rill/shared';
import { ApiError } from '../api/client';
import { confirmStage, generateStage, parseAnswers, rollbackStage, setMode } from '../api/novel';
import { StagePanel } from '../components/pipeline/StagePanel';
import { StatusTag } from '../components/StatusTag';
import { useProject } from '../hooks/useProject';
import { useWorkspaceProject } from '../hooks/useWorkspaceProject';
import { isImplementedStage, readStageState } from '../lib/stage';

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
  const { setProject, viewedStage, setViewedStage } = useWorkspaceProject();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  // 项目数据发布给侧栏（卸载或加载失败时清空，「后续阶段」区随之隐藏）
  useEffect(() => {
    setProject(project);
    return () => {
      setProject(null);
      setViewedStage(null);
    };
  }, [project, setProject, setViewedStage]);

  const answers = useMemo(() => {
    if (!project) return null;
    try {
      return parseAnswers(project);
    } catch {
      return null;
    }
  }, [project]);

  /** 问卷已选维度（类型 · 篇幅 · 基调 · 视角），以 chips 展示 */
  const dimensionChips = useMemo(() => {
    if (!answers) return [];
    return [
      GENRE_LABELS[answers.genre] ?? answers.genre,
      LENGTH_LABELS[answers.length] ?? answers.length,
      answers.tone,
      answers.pov,
    ];
  }, [answers]);

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
        message.warning(e.message || '项目状态已变化，请刷新后重试');
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
    project.currentStage !== 'outline' &&
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
            disabled={busy || project.status === 'running'}
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
          <div style={{ marginBottom: 20 }}>
            <p className="dim-caption">问卷已选维度（只读）</p>
            <div className="dim-chips">
              {dimensionChips.map((chip) => (
                <span key={chip} className="dim-chip">
                  {chip}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="canvas-well">
          <StagePanel
            project={project}
            stage={stage}
            busy={busy}
            onOutlineRefresh={() => {
              void refresh();
              restartPolling();
            }}
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
  );

  function handleConfirm() {
    void runAction(() => confirmStage(project!.id), '已确认，正在生成下一阶段');
  }
}
