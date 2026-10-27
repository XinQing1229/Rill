import { CoverThumbnail } from '../components/cover/CoverThumbnail';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Popover,
  Segmented,
  Select,
  Skeleton,
  Tag,
} from 'antd';
import {
  CloseCircleOutlined,
  EditOutlined,
  FileOutlined,
  FolderOutlined,
  Loading3QuartersOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import {
  genreLabel,
  LENGTH_LABELS,
  PUBLICATION_STATUS_LABELS,
  STAGE_LABELS,
  type PublicationStatus,
  type ProjectScope,
  type ProjectSummary,
} from '@rill/shared';
import {
  clearTrash,
  deleteProject,
  listProjects,
  purgeProject,
  restoreProject,
  setPublicationStatus,
} from '../api/novel';
import { StatusTag } from '../components/StatusTag';
import { formatUpdatedAt } from '../lib/stage';
import './ProjectListPage.css';

/** 列表页回答的问题：「我的项目进行到哪了？」以及「刚删的项目还能找回来吗？」 */
export function ProjectListPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<ProjectScope>('active');
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [savingPublicationId, setSavingPublicationId] = useState<string | null>(null);
  const trash = scope === 'trash';
  const [search, setSearch] = useState('');
  const visibleProjects = projects?.filter((project) =>
    project.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      setProjects(await listProjects(scope));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 删除/恢复/清理走同一出口：失败展示后端文案，成功后整体刷新，不做乐观更新 */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setActionError(null);
      try {
        await action();
        await load();
      } catch (e: unknown) {
        setActionError(e instanceof Error ? e.message : '操作失败，请重试');
      }
    },
    [load],
  );

  const changePublicationStatus = async (id: string, publicationStatus: PublicationStatus) => {
    setSavingPublicationId(id);
    try {
      await run(() => setPublicationStatus(id, { publicationStatus }));
    } finally {
      setSavingPublicationId(null);
    }
  };

  const counts = useMemo(() => {
    const list = projects ?? [];
    return {
      total: list.length,
      idle: list.filter((p) => p.status === 'idle').length,
      running: list.filter((p) => p.status === 'running').length,
      failed: list.filter((p) => p.status === 'failed').length,
    };
  }, [projects]);

  const submitClearTrash = () => {
    setClearOpen(false);
    void run(clearTrash);
  };

  const subtitle = (() => {
    if (projects === null) return '加载中…';
    if (trash) return `${projects.length} 个已删除项目，按最近删除排序`;
    return `${projects.length} 个创作项目，按最近更新排序`;
  })();

  return (
    <div className="page project-list">
      <div className="title-row">
        <div>
          <h1>{trash ? '回收站' : '项目'}</h1>
          <div className="sub">{subtitle}</div>
        </div>
        <div className="project-list-actions">
          <Input
            aria-label="搜索项目"
            placeholder="搜索项目…"
            prefix={<SearchOutlined aria-hidden="true" />}
            allowClear
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {trash ? (
            <Button danger disabled={!projects?.length} onClick={() => setClearOpen(true)}>
              清空回收站
            </Button>
          ) : (
            <Link to="/new">
              <Button type="primary" icon={<PlusOutlined />}>
                新建项目
              </Button>
            </Link>
          )}
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

      {actionError !== null && (
        <Alert
          type="error"
          showIcon
          message="操作未完成"
          description={actionError}
          closable
          onClose={() => setActionError(null)}
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
        <Empty
          description={
            trash ? '回收站是空的：删除的项目会出现在这里' : '还没有项目：从问卷开始，先生成种子'
          }
        >
          {!trash && (
            <Link to="/new">
              <Button type="primary">新建项目</Button>
            </Link>
          )}
        </Empty>
      )}

      {projects !== null && projects.length > 0 && (
        <>
          {!trash && (
            <div className="kpis">
              <div className="kpi kpi-total">
                <span className="kpi-icon">
                  <FileOutlined />
                </span>
                <div className="kpi-label">项目总数</div>
                <div className="kpi-value num">{counts.total}</div>
              </div>
              <div className="kpi kpi-idle">
                <span className="kpi-icon">
                  <EditOutlined />
                </span>
                <div className="kpi-label">待操作</div>
                <div className="kpi-value num">{counts.idle}</div>
              </div>
              <div className="kpi kpi-running">
                <span className="kpi-icon">
                  <Loading3QuartersOutlined />
                </span>
                <div className="kpi-label">生成中</div>
                <div className="kpi-value num">{counts.running}</div>
              </div>
              <div className="kpi kpi-failed">
                <span className="kpi-icon">
                  <CloseCircleOutlined />
                </span>
                <div className="kpi-label">失败</div>
                <div className="kpi-value num">{counts.failed}</div>
              </div>
            </div>
          )}

          <div className="rows">
            {visibleProjects?.map((project) =>
              trash ? (
                <div key={project.id} className="row project-trash-row">
                  <span className="t">
                    {project.title}
                    <span className="sub">
                      {genreLabel(project.genre)} · {LENGTH_LABELS[project.length] ?? '历史篇幅'} ·{' '}
                      {project.deletedAt
                        ? `删除于 ${formatUpdatedAt(project.deletedAt)}`
                        : '已删除'}
                    </span>
                  </span>
                  <span className="stage-cell">
                    <span>停留阶段</span>
                    <span style={{ fontWeight: 500 }}>{STAGE_LABELS[project.currentStage]}</span>
                  </span>
                  <StatusTag status={project.status} />
                  <Tag>{PUBLICATION_STATUS_LABELS[project.publicationStatus]}</Tag>
                  <span className="when">
                    <Button size="small" onClick={() => void run(() => restoreProject(project.id))}>
                      恢复
                    </Button>
                  </span>
                  <span>
                    <Popconfirm
                      title="永久删除该项目"
                      description="删除后不可恢复，各阶段产物与用量记录一并清除。"
                      okText="永久删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => void run(() => purgeProject(project.id))}
                    >
                      <Button size="small" danger>
                        永久删除
                      </Button>
                    </Popconfirm>
                  </span>
                </div>
              ) : (
                <div
                  key={project.id}
                  className="row"
                  role="button"
                  tabIndex={0}
                  onClick={() => void navigate(`/projects/${project.id}`)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                      e.preventDefault();
                      void navigate(`/projects/${project.id}`);
                    }
                  }}
                >
                  <span className="project-cover" aria-hidden="true">
                    {project.cover && (
                      <CoverThumbnail
                        projectId={project.id}
                        assetId={project.cover.assetId}
                        alt=""
                      />
                    )}
                  </span>
                  <span className="project-info">
                    <span className="t">{project.title}</span>
                    <span className="sub project-meta">
                      <FolderOutlined aria-hidden="true" />
                      {genreLabel(project.genre)} · {LENGTH_LABELS[project.length] ?? '历史篇幅'} ·{' '}
                      {project.mode === 'manual' ? '手动推进' : '自动推进'}
                    </span>
                    <span className="stage-cell">
                      <span>当前阶段</span>
                      <strong>{STAGE_LABELS[project.currentStage]}</strong>
                    </span>
                  </span>
                  {project.status !== 'done' && (
                    <span className="project-status">
                      <StatusTag status={project.status} />
                    </span>
                  )}
                  <span
                    className="project-publication"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <span className="sub">发布状态</span>
                    <Select<PublicationStatus>
                      aria-label={`${project.title}的发布状态`}
                      value={project.publicationStatus}
                      loading={savingPublicationId === project.id}
                      disabled={savingPublicationId !== null}
                      className="publication-select"
                      options={Object.entries(PUBLICATION_STATUS_LABELS).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                      onChange={(value) => void changePublicationStatus(project.id, value)}
                    />
                  </span>
                  <span className="when">{formatUpdatedAt(project.updatedAt)}</span>
                  <span
                    className="project-more"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Popover
                      trigger="click"
                      placement="bottomRight"
                      content={
                        <Popconfirm
                          title="删除该项目"
                          description="删除后进入回收站，可在回收站恢复；产物会完整保留。"
                          okText="删除"
                          okButtonProps={{ danger: true }}
                          cancelText="取消"
                          onConfirm={() => void run(() => deleteProject(project.id))}
                        >
                          <Button size="small" danger>
                            删除
                          </Button>
                        </Popconfirm>
                      }
                    >
                      <Button
                        type="text"
                        icon={<MoreOutlined />}
                        aria-label={`${project.title}的更多操作`}
                      />
                    </Popover>
                  </span>
                </div>
              ),
            )}
          </div>
        </>
      )}

      {projects !== null && projects.length > 0 && visibleProjects?.length === 0 && (
        <Empty description="没有找到匹配的项目" />
      )}
      <div className="project-list-scope">
        <Segmented<ProjectScope>
          value={scope}
          onChange={(value) => {
            setScope(value);
            setProjects(null);
            setSearch('');
          }}
          options={[
            { label: '全部项目', value: 'active' },
            { label: '回收站', value: 'trash' },
          ]}
        />
      </div>

      <Modal
        open={clearOpen}
        title="清空回收站"
        okText="清空回收站"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onOk={submitClearTrash}
        onCancel={() => setClearOpen(false)}
      >
        <p>回收站内的所有项目将被永久删除，包括其全部阶段产物，且无法恢复。</p>
      </Modal>
    </div>
  );
}
