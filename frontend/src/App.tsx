import { useMemo, useState } from 'react';
import { Route, Routes, useLocation, Link } from 'react-router-dom';
import { STAGE_LABELS, type ProjectDetail, type Stage } from '@rill/shared';
import { ProjectListPage } from './pages/ProjectListPage';
import { NewProjectPage } from './pages/NewProjectPage';
import { ProjectWorkspacePage } from './pages/ProjectWorkspacePage';
import { HealthCard } from './components/HealthCard';
import { LlmPingCard } from './components/LlmPingCard';
import { useProjectCount } from './hooks/useProjectCount';
import { WorkspaceProjectContext } from './hooks/useWorkspaceProject';
import { readStageState, timelineStages, type StageState } from './lib/stage';

/** 侧栏阶段状态 pill（深色底配色） */
function SideStatePill({ state }: { state: StageState | undefined }) {
  let label = '待生成';
  let background = 'rgba(255, 255, 255, 0.08)';
  let color = '#9a9ea6';
  if (state) {
    if (state.status === 'generating') {
      label = '生成中';
      background = 'rgba(56, 189, 248, 0.16)';
      color = '#38bdf8';
    } else if (state.status === 'failed') {
      label = '失败';
      background = 'rgba(248, 113, 113, 0.16)';
      color = '#f87171';
    } else if (state.status === 'done') {
      if (state.stale) {
        label = '已失效';
        background = 'rgba(251, 191, 36, 0.16)';
        color = '#fbbf24';
      } else {
        label = '已完成';
        background = 'rgba(52, 199, 110, 0.16)';
        color = '#4ade80';
      }
    }
  }
  return (
    <span className="pill" style={{ background, color }}>
      {label}
    </span>
  );
}

/** 侧栏阶段条目：圆点 + 键名/中文名 + 状态 pill；点击切换工作台查看的阶段 */
function SideStageItem({
  stage,
  project,
  viewedStage,
  onSelect,
}: {
  stage: Stage;
  project: ProjectDetail;
  viewedStage: Stage | null;
  onSelect: (stage: Stage | null) => void;
}) {
  const state = readStageState(project, stage);
  const isCurrent = stage === project.currentStage;
  const isViewed = viewedStage === stage || (viewedStage === null && isCurrent);
  const cls = ['side-stage', 'clickable', state?.status ?? 'pending', isViewed ? 'viewed' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      aria-current={isViewed ? 'true' : undefined}
      onClick={() => onSelect(isCurrent ? null : stage)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect(isCurrent ? null : stage);
      }}
    >
      <span className="dot" />
      <div className="st-text">
        <div className="st-key">{stage}</div>
        <div className="st-name">{STAGE_LABELS[stage]}</div>
      </div>
      <SideStatePill state={state} />
    </div>
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
  refresh: (
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
      <path d="M13.5 8a5.5 5.5 0 1 1-1.62-3.9" />
      <path d="M13.5 2.6v2.7h-2.7" />
    </svg>
  ),
};

const brandMark = (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="brand-grad" x1="0" y1="0" x2="26" y2="26" gradientUnits="userSpaceOnUse">
        <stop stopColor="#4f7cf7" />
        <stop offset="1" stopColor="#7b5bf0" />
      </linearGradient>
    </defs>
    <rect width="26" height="26" rx="7" fill="url(#brand-grad)" />
    <path d="M13 6.5 19 10l-6 3.5L7 10z" fill="#fff" />
    <path
      d="m7 13.6 6 3.5 6-3.5"
      stroke="#fff"
      strokeOpacity=".7"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="m7 17 6 3.5 6-3.5"
      stroke="#fff"
      strokeOpacity=".35"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** 外壳：深色侧栏 + 白 sheet */
function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { count } = useProjectCount(location.pathname);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [viewedStage, setViewedStage] = useState<Stage | null>(null);
  const contextValue = useMemo(
    () => ({ project, setProject, viewedStage, setViewedStage }),
    [project, viewedStage],
  );
  const selected = useMemo(() => {
    if (location.pathname === '/new') return 'new';
    if (location.pathname === '/health') return 'health';
    if (location.pathname.startsWith('/projects')) return 'projects';
    return 'projects';
  }, [location.pathname]);

  return (
    <WorkspaceProjectContext.Provider value={contextValue}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            {brandMark}
            <span className="word">
              Rill<small>小说创作</small>
            </span>
          </div>
          <div className="group-label">创作</div>
          <nav aria-label="主导航">
            <NavItem to="/" active={selected === 'projects'} label="项目" badge={count}>
              {navIcon.list}
            </NavItem>
            <NavItem to="/new" active={selected === 'new'} label="新建项目">
              {navIcon.plus}
            </NavItem>
          </nav>
          {project && (
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
                {/* 本 change 范围外：置灰预告 */}
                <div className="side-stage locked">
                  <span className="dot" />
                  <div className="st-text">
                    <div className="st-key">beats → prose</div>
                    <div className="st-name">细纲 · 正文，即将开放</div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="bottom">
            <NavItem to="/health" active={selected === 'health'} label="诊断">
              {navIcon.refresh}
            </NavItem>
          </div>
        </aside>
        <main className="sheet">{children}</main>
      </div>
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
        <Route path="/new" element={<NewProjectPage />} />
        <Route path="/projects/:id" element={<ProjectWorkspacePage />} />
        <Route
          path="/health"
          element={
            <div className="page">
              <div className="title-row">
                <div>
                  <h1>诊断</h1>
                  <div className="sub">AI 基建与健康检查</div>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 16, maxWidth: 420 }}>
                <HealthCard />
                <LlmPingCard />
              </div>
            </div>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Shell>
  );
}
