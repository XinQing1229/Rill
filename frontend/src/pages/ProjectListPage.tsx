import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Skeleton, Alert } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import {
  GENRE_LABELS,
  LENGTH_LABELS,
  STAGE_LABELS,
  type ProjectSummary,
} from '@rill/shared';
import { listProjects } from '../api/novel';
import { StatusTag } from '../components/StatusTag';
import { formatUpdatedAt } from '../lib/stage';

/** 列表页回答的问题：「我的项目进行到哪了？」 */
export function ProjectListPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listProjects()
      .then(setProjects)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载失败'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const list = projects ?? [];
    return {
      total: list.length,
      idle: list.filter((p) => p.status === 'idle').length,
      running: list.filter((p) => p.status === 'running').length,
      failed: list.filter((p) => p.status === 'failed').length,
    };
  }, [projects]);

  return (
    <div className="page">
      <div className="title-row">
        <div>
          <h1>项目</h1>
          <div className="sub">
            {projects === null ? '加载中…' : `${projects.length} 个创作项目，按最近更新排序`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/new">
            <Button type="primary">新建项目</Button>
          </Link>
        </div>
      </div>

      {error !== null && (
        <Alert
          type="error"
          showIcon
          message="项目列表加载失败"
          description={error}
          action={
            <Button size="small" onClick={load}>
              重试
            </Button>
          }
          style={{ marginBottom: 24 }}
        />
      )}

      {projects === null && error === null && (
        <div aria-busy="true">
          <Skeleton active paragraph={{ rows: 0 }} style={{ marginBottom: 24 }} />
          <Skeleton active paragraph={{ rows: 4 }} />
        </div>
      )}

      {projects !== null && projects.length === 0 && (
        <Empty description="还没有项目：从问卷开始，先生成种子">
          <Link to="/new">
            <Button type="primary">新建项目</Button>
          </Link>
        </Empty>
      )}

      {projects !== null && projects.length > 0 && (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">项目</div>
              <div className="kpi-value num">{counts.total}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">待操作</div>
              <div className="kpi-value num">{counts.idle}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">生成中</div>
              <div className="kpi-value num">{counts.running}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">失败</div>
              <div className="kpi-value num">{counts.failed}</div>
            </div>
          </div>

          <div className="rows">
            {projects.map((project) => (
              <div
                key={project.id}
                className="row"
                role="button"
                tabIndex={0}
                onClick={() => void navigate(`/projects/${project.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void navigate(`/projects/${project.id}`);
                }}
              >
                <span className="t">
                  {project.title}
                  <span className="sub">
                    {GENRE_LABELS[project.genre]} · {LENGTH_LABELS[project.length]} ·{' '}
                    {project.mode === 'manual' ? '手动推进' : '自动推进'}
                  </span>
                </span>
                <span className="stage-cell">
                  <span>当前阶段</span>
                  <span style={{ fontWeight: 500 }}>{STAGE_LABELS[project.currentStage]}</span>
                </span>
                <StatusTag status={project.status} />
                <span className="when">{formatUpdatedAt(project.updatedAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
