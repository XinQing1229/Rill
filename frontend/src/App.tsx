import { ExportOutlined, PictureOutlined } from '@ant-design/icons';
import rillLogo from './assets/rill-logo.png';
import { StageIcon } from './components/StageIcon';
import './components/AppSidebar.css';
import './pages/ProjectWorkspacePage.css';
import { ApiKeySettingsPage } from './pages/ApiKeySettingsPage';
import { useEffect, useMemo, useState } from 'react';
import { Route, Routes, useLocation, Link } from 'react-router-dom';
import {
  ApiKeySettingsSchema,
  MODEL_DISPLAY_NAME,
  STAGE_LABELS,
  type ProjectDetail,
  type Stage,
} from '@rill/shared';
import { ProjectListPage } from './pages/ProjectListPage';
import { NewProjectPage } from './pages/NewProjectPage';
import { ProjectWorkspacePage } from './pages/ProjectWorkspacePage';
import { useProjectCount } from './hooks/useProjectCount';
import { type WorkspaceView, WorkspaceProjectContext } from './hooks/useWorkspaceProject';
import { readStageState, timelineStages, type StageState } from './lib/stage';
import { ModelSettingsContext } from './contexts/ModelSettingsContext';
import { get } from './api/client';

/** 阶段状态使用适配浅色侧栏的语义颜色。 */
function SideStatePill({ state }: { state: StageState | undefined }) {
  const status = state?.status === 'done' && state.stale ? 'stale' : (state?.status ?? 'pending');
  const labels = {
    pending: '待生成',
    generating: '生成中',
    failed: '失败',
    done: '已完成',
    stale: '已失效',
  };
  return <span className={`pill side-state side-state-${status}`}>{labels[status]}</span>;
}

/** 点击阶段按钮切换工作台；选中状态不改变实际创作进度。 */
function SideStageItem({
  stage,
  project,
  viewedStage,
  onSelect,
}: {
  stage: Stage;
  project: ProjectDetail;
  viewedStage: WorkspaceView | null;
  onSelect: (stage: WorkspaceView | null) => void;
}) {
  const state = readStageState(project, stage);
  const isCurrent = stage === project.currentStage;
  const isViewed =
    (viewedStage?.kind === 'stage' && viewedStage.stage === stage) ||
    (viewedStage === null && isCurrent);
  const cls = ['side-stage', 'clickable', state?.status ?? 'pending', isViewed ? 'viewed' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-current={isViewed ? 'true' : undefined}
      onClick={() => onSelect(isCurrent ? null : { kind: 'stage', stage })}
    >
      <StageIcon stage={stage} />
      <span className="st-text">
        <span className="st-name">{STAGE_LABELS[stage]}</span>
      </span>
      <SideStatePill state={state} />
    </button>
  );
}

/** 侧栏导航项 */
function NavItem({
  to,
  active,
  label,
  badge,
  children,
}: {
  to: string;
  active: boolean;
  label: string;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`nav-item${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {children}
      {label}
      {badge !== undefined && <span className="count num">{badge}</span>}
    </Link>
  );
}

const navIcon = {
  list: (
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
      <path d="M2.5 3.5h11v9h-11z" />
      <path d="M5 6.5h6M5 9h4" />
    </svg>
  ),
  plus: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  ),
  settings: (
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
      <path d="M6.55 1.75h2.9l.42 1.68a5 5 0 0 1 1.08.63l1.66-.5 1.45 2.5-1.24 1.22a5 5 0 0 1 0 1.25l1.24 1.22-1.45 2.5-1.66-.5a5 5 0 0 1-1.08.63l-.42 1.67h-2.9l-.42-1.67a5 5 0 0 1-1.08-.63l-1.66.5-1.45-2.5 1.24-1.22a5 5 0 0 1 0-1.25L1.94 6.06l1.45-2.5 1.66.5a5 5 0 0 1 1.08-.63l.42-1.68Z" />
      <circle cx="8" cy="7.9" r="2.1" />
    </svg>
  ),
};

/** 外壳：统一浅色侧栏 + 白 sheet */
function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { count } = useProjectCount(location.pathname);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [viewedStage, setViewedStage] = useState<WorkspaceView | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void get('/api/llm/settings')
      .then((response) => ApiKeySettingsSchema.parse(response))
      .then((settings) => {
        if (mounted) setActiveModel(MODEL_DISPLAY_NAME[settings.activeProvider]);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);
  const contextValue = useMemo(
    () => ({ project, setProject, viewedStage, setViewedStage }),
    [project, viewedStage],
  );
  const selected = useMemo(() => {
    if (location.pathname === '/new') return 'new';
    if (location.pathname === '/settings') return 'settings';
    if (location.pathname.startsWith('/projects')) return 'projects';
    return 'projects';
  }, [location.pathname]);

  return (
    <WorkspaceProjectContext.Provider value={contextValue}>
      <ModelSettingsContext.Provider value={{ activeModel, setActiveModel }}>
        <div
          className={`shell${selected === 'new' ? ' shell-new-project' : location.pathname === '/' ? ' shell-project-list' : location.pathname.startsWith('/projects/') ? ' shell-workspace' : ''}`}
        >
          <aside className="sidebar">
            <Link className="brand" to="/" aria-label="Rill 首页">
              <svg
                className="brand-logo"
                width="130"
                height="54"
                viewBox="260 287 1020 420"
                aria-hidden="true"
              >
                {/* 通过视口去除原图留白，保留原始 Logo 的比例与细节。 */}
                <image href={rillLogo} width="1536" height="1024" />
              </svg>
            </Link>
            <div className="group-label">创作</div>
            <nav aria-label="主导航">
              <NavItem to="/" active={selected === 'projects'} label="项目" badge={count}>
                {navIcon.list}
              </NavItem>
              <NavItem to="/new" active={selected === 'new'} label="新建项目">
                {navIcon.plus}
              </NavItem>
            </nav>
            {location.pathname.startsWith('/projects/') && project && (
              <div className="side-group">
                <div className="group-label">后续阶段</div>
                <div className="side-stages">
                  {timelineStages(project.stages).map((stage) => (
                    <SideStageItem
                      key={stage}
                      stage={stage}
                      project={project}
                      viewedStage={viewedStage}
                      onSelect={setViewedStage}
                    />
                  ))}
                  <button
                    className={`side-stage clickable cover-nav ${viewedStage?.kind === 'cover' ? 'viewed' : ''}`}
                    aria-current={viewedStage?.kind === 'cover' ? 'page' : undefined}
                    onClick={() => setViewedStage({ kind: 'cover' })}
                  >
                    <span className="stage-icon" aria-hidden="true">
                      <PictureOutlined />
                    </span>
                    <span className="st-text">
                      <span className="st-name">封面管理</span>
                    </span>
                  </button>
                  <button
                    className={`side-stage clickable ${viewedStage?.kind === 'book-export' ? 'viewed' : ''}`}
                    aria-current={viewedStage?.kind === 'book-export' ? 'page' : undefined}
                    onClick={() => setViewedStage({ kind: 'book-export' })}
                  >
                    <span className="stage-icon" aria-hidden="true">
                      <ExportOutlined />
                    </span>
                    <span className="st-text">
                      <span className="st-name">导出书本</span>
                    </span>
                  </button>
                </div>
              </div>
            )}
            <div className="bottom">
              {activeModel && (
                <div className="current-model" aria-label={`当前使用 ${activeModel} 模型`}>
                  <span>当前使用</span>
                  <strong>{activeModel}</strong>
                </div>
              )}
              <NavItem to="/settings" active={selected === 'settings'} label="模型设置">
                {navIcon.settings}
              </NavItem>
            </div>
          </aside>
          <main className="sheet">{children}</main>
        </div>
      </ModelSettingsContext.Provider>
    </WorkspaceProjectContext.Provider>
  );
}

function NotFoundPage() {
  return (
    <div className="page">
      <div className="title-row">
        <div>
          <h1>页面不存在</h1>
          <div className="sub">
            访问的路径不存在，
            <Link to="/" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
              返回项目列表
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<ProjectListPage />} />
        <Route path="/settings" element={<ApiKeySettingsPage />} />
        <Route path="/new" element={<NewProjectPage />} />
        <Route path="/projects/:id" element={<ProjectWorkspacePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Shell>
  );
}
