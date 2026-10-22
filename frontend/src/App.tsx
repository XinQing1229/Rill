import { useMemo } from 'react';
import { Route, Routes, useLocation, Link } from 'react-router-dom';
import { ProjectListPage } from './pages/ProjectListPage';
import { NewProjectPage } from './pages/NewProjectPage';
import { ProjectWorkspacePage } from './pages/ProjectWorkspacePage';
import { HealthCard } from './components/HealthCard';
import { LlmPingCard } from './components/LlmPingCard';
import { useProjectCount } from './hooks/useProjectCount';

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
    <Link to={to} className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
      {children}
      {label}
      {badge !== undefined && <span className="count num">{badge}</span>}
    </Link>
  );
}

const navIcon = {
  list: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3.5h11v9h-11z" />
      <path d="M5 6.5h6M5 9h4" />
    </svg>
  ),
  plus: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  ),
  stethoscope: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.5v3l2 1.2" />
    </svg>
  ),
};

const brandMark = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2 5c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 4 2" stroke="#1b6c80" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M2 9c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 4 2" stroke="#1b6c80" strokeWidth="1.5" strokeLinecap="round" opacity=".55" />
    <path d="M2 13c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 4 2" stroke="#1b6c80" strokeWidth="1.5" strokeLinecap="round" opacity=".3" />
  </svg>
);

/** 外壳：侧栏 + 白 sheet */
function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { count } = useProjectCount(location.pathname);
  const selected = useMemo(() => {
    if (location.pathname === '/new') return 'new';
    if (location.pathname === '/health') return 'health';
    if (location.pathname.startsWith('/projects')) return 'projects';
    return 'projects';
  }, [location.pathname]);

  return (
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
        <div className="bottom">
          <NavItem to="/health" active={selected === 'health'} label="诊断">
            {navIcon.stethoscope}
          </NavItem>
        </div>
      </aside>
      <main className="sheet">{children}</main>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="page">
      <div className="title-row">
        <div>
          <h1>页面不存在</h1>
          <div className="sub">
            访问的路径不存在，<Link to="/" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>返回项目列表</Link>
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
