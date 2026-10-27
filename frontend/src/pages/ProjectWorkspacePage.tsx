import { CoverWorkbench } from '../components/cover/CoverWorkbench';
import { CoverThumbnail } from '../components/cover/CoverThumbnail';
import {
  ApartmentOutlined,
  BookOutlined,
  CalendarOutlined,
  RightOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import './ProjectWorkspacePage.css';
import { BookExportWorkbench } from '../components/book-export/BookExportWorkbench';
import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Modal, Skeleton } from 'antd';
import { Link, useParams } from 'react-router-dom';
import {
  genreLabel,
  WRITING_STYLE_LABELS,
  LENGTH_LABELS,
  STAGE_LABELS,
  type PipelineMode,
} from '@rill/shared';
import { ApiError } from '../api/client';
import { confirmStage, generateStage, parseAnswers, rollbackStage, setMode } from '../api/novel';
import { StagePanel } from '../components/pipeline/StagePanel';
import { PipelineModeSelect } from '../components/PipelineModeSelect';
import { StatusTag } from '../components/StatusTag';
import { useProject } from '../hooks/useProject';
import { useWorkspaceProject } from '../hooks/useWorkspaceProject';
import { isImplementedStage, readStageState, timelineStages } from '../lib/stage';

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
  const [draftMode, setDraftMode] = useState<PipelineMode | null>(null);

  // 项目数据发布给侧栏（卸载或加载失败时清空，「后续阶段」区随之隐藏）
  useEffect(() => {
    setProject(project);
  }, [project, setProject]);
  useEffect(
    () => () => {
      setProject(null);
      setViewedStage(null);
    },
    [id, setProject, setViewedStage],
  );

  const answers = useMemo(() => {
    if (!project) return null;
    try {
      return parseAnswers(project);
    } catch {
      return null;
    }
  }, [project]);

  /** 问卷已选维度（类型 · 篇幅 · 阅读体验 · 视角），以 chips 展示 */
  const dimensionChips = useMemo(() => {
    if (!answers) return [];
    return [
      genreLabel(answers.genre),
      LENGTH_LABELS[answers.length] ?? '历史篇幅',
      answers.tone,
      answers.pov,
      `文风：${answers.writingStyle ? WRITING_STYLE_LABELS[answers.writingStyle.id] : '未指定'}`,
    ].filter((value): value is string => Boolean(value));
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
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        message.warning(e.message || '项目状态已变化，请刷新后重试');
        await refresh();
        restartPolling();
      } else {
        message.error(e instanceof Error ? e.message : '操作失败');
      }
      return false;
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

  const stage = viewedStage?.kind === 'stage' ? viewedStage.stage : project.currentStage;
  const viewingExport = viewedStage?.kind === 'book-export';
  const viewingCover = viewedStage?.kind === 'cover';
  const currentState = readStageState(project, project.currentStage);
  const currentImplemented = isImplementedStage(project.currentStage);
  const canConfirm =
    !viewingExport &&
    !viewingCover &&
    project.currentStage !== 'outline' &&
    project.currentStage !== 'prose' &&
    project.mode === 'manual' &&
    currentImplemented &&
    currentState?.status === 'done' &&
    !currentState.stale;

  const modeLocked = busy || project.status === 'running';
  const handleModeSave = async () => {
    if (draftMode === null || draftMode === project.mode || modeLocked) return;
    const saved = await runAction(
      () => setMode(project.id, draftMode),
      draftMode === 'auto' ? '已切换为自动推进' : '已切换为手动推进',
    );
    if (saved) setDraftMode(null);
  };

  return (
    <div className="workspace-page">
      <div className="builder-bar workspace-toolbar">
        <Link to="/" className="back" aria-label="返回项目">
          {backArrow}项目
        </Link>
        <RightOutlined className="workspace-crumb-separator" aria-hidden="true" />
        <span className="workspace-crumb-title">{project.title}</span>
        {viewingCover && (
          <>
            <RightOutlined className="workspace-crumb-separator" aria-hidden="true" />
            <span className="workspace-crumb-title">封面管理</span>
          </>
        )}
        <div className="right">
          {viewingCover ? (
            <Button onClick={() => setViewedStage(null)}>返回项目</Button>
          ) : (
            <span className="workspace-mode">
              {project.mode === 'manual' ? '手动推进' : '自动推进'}
            </span>
          )}
          <Button
            type="primary"
            icon={<SettingOutlined aria-hidden="true" />}
            onClick={() => setDraftMode(project.mode)}
          >
            项目设置
          </Button>
          {canConfirm && (
            <Button type="primary" loading={busy} onClick={() => handleConfirm()}>
              确认并推进
            </Button>
          )}
        </div>
      </div>

      <Modal
        title="项目设置"
        open={draftMode !== null}
        onCancel={() => setDraftMode(null)}
        onOk={() => void handleModeSave()}
        okText="保存修改"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ disabled: modeLocked || draftMode === project.mode }}
      >
        <h3>推进模式</h3>
        {draftMode !== null && (
          <PipelineModeSelect value={draftMode} onChange={setDraftMode} disabled={modeLocked} />
        )}
        <p className="hint" role="status">
          {project.status === 'running'
            ? '项目正在生成，停止运行后才可修改推进模式。'
            : '保存后将在下次生成或继续推进时生效，不会立即启动生成。'}
        </p>
      </Modal>
      <div className="page">
        <section className="workspace-overview" aria-label="项目信息">
          <button
            className="workspace-cover"
            aria-label="管理项目封面"
            onClick={() => setViewedStage({ kind: 'cover' })}
          >
            <CoverThumbnail
              projectId={project.id}
              assetId={project.cover?.assetId}
              alt="项目封面"
            />
          </button>
          <div className="workspace-overview-body">
            <div className="workspace-title-row">
              <h1>{project.title}</h1>
              <StatusTag status={project.status} />
            </div>
            <div className="workspace-project-meta">
              <span>
                <BookOutlined aria-hidden="true" />
                小说创作
              </span>
              <span>
                <ApartmentOutlined aria-hidden="true" />
                {timelineStages(project.stages).length} 个阶段
              </span>
              <span>
                <CalendarOutlined aria-hidden="true" />
                最近更新{' '}
                <time dateTime={project.updatedAt}>{formatProjectDate(project.updatedAt)}</time>
              </span>
            </div>
            {project.status === 'failed' && <p className="hint">上次生成失败，可在对应阶段重试</p>}
            {answers !== null && (
              <div className="workspace-dimensions">
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
          </div>
        </section>
        <div className="canvas-well">
          {viewingCover ? (
            <CoverWorkbench key={project.id} projectId={project.id} onChanged={refresh} />
          ) : viewingExport ? (
            <BookExportWorkbench key={project.id} projectId={project.id} />
          ) : (
            <StagePanel
              project={project}
              stage={stage}
              busy={busy}
              onBusyChange={setBusy}
              onOutlineRefresh={() => {
                void refresh();
                restartPolling();
              }}
              onGenerate={async (force) => {
                await runAction(() => generateStage(project.id, force ? { force: true } : {}));
              }}
              onConfirm={() => handleConfirm()}
              onRollback={(target) =>
                void runAction(
                  () => rollbackStage(project.id, target),
                  `已回退到「${STAGE_LABELS[target]}」，其后阶段产物标记为失效`,
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  );

  function handleConfirm() {
    void runAction(() => confirmStage(project!.id), '已确认，正在生成下一阶段');
  }
}

/** 日期采用用户浏览器的本地时区，与工作台其他时间展示一致。 */
function formatProjectDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
