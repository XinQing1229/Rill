import { useWorkspaceProject } from '../../hooks/useWorkspaceProject';
import { coverImageUrl } from '../../api/cover';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  List,
  Pagination,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { type BookFormat, type BookJob, type BookPreview, type BookSettings } from '@rill/shared';
import * as api from '../../api/book-export';
import { ChapterCopy } from './ChapterCopy';
import './BookExportWorkbench.css';
const statusLabels: Record<BookJob['status'], string> = {
  preparing: '准备内容',
  generating: '生成文件',
  succeeded: '已完成',
  partial_failed: '部分失败',
  failed: '失败',
  paused: '已暂停',
  deleting: '正在删除',
  delete_failed: '删除失败',
};
export function BookExportWorkbench({ projectId }: { projectId: string }) {
  const { project, setViewedStage } = useWorkspaceProject();
  const [settings, setSettings] = useState<BookSettings | null>(null);
  const [saved, setSaved] = useState('');
  const [preview, setPreview] = useState<BookPreview | null>(null);
  const [selected, setSelected] = useState(1);
  const [formats, setFormats] = useState<BookFormat[]>(['txt', 'markdown', 'epub']);
  const [jobs, setJobs] = useState<BookJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const dirty = !!settings && JSON.stringify(settings) !== saved;
  const refreshJobs = useCallback(async () => {
    try {
      const r = await api.listBookJobs(projectId, page);
      setJobs(r.items);
      setTotal(r.total);
      setHistoryError('');
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : '读取历史失败');
    }
  }, [projectId, page]);
  useEffect(() => {
    let cancelled = false;
    void api
      .getBookSettings(projectId)
      .then((s) => {
        if (!cancelled) {
          setSettings(s);
          setSaved(JSON.stringify(s));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '读取成书信息失败');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);
  const running = jobs.some((j) =>
    ['preparing', 'generating', 'deleting', 'paused'].includes(j.status),
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refreshJobs(), 2000);
    return () => clearInterval(timer);
  }, [running, refreshJobs]);
  const action = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  if (!settings)
    return (
      <section aria-label="导出书本">
        {error ? <Alert type="error" message={error} /> : <Spin aria-label="读取成书信息" />}
      </section>
    );
  const setField = (field: 'title' | 'author' | 'introduction', value: string) => {
    setSettings({ ...settings, [field]: value });
    setPreview(null);
  };
  const titleChange = (number: number, title: string) => {
    setSettings({
      ...settings,
      chapters: settings.chapters.map((c) =>
        c.chapterNumber === number ? { ...c, title, needsCheck: false } : c,
      ),
      chapterTitles: [
        ...settings.chapterTitles.filter((c) => c.chapterNumber !== number),
        { chapterNumber: number, title, outlineRevision: settings.outlineRevision },
      ].sort((a, b) => a.chapterNumber - b.chapterNumber),
    });
    setPreview(null);
  };
  const previewChapter = (number: number, token?: string) =>
    action(async () => {
      setPreview(await api.previewBook(projectId, number, token));
      setSelected(number);
    });
  return (
    <section className="book-export" aria-label="导出书本">
      <div>
        <Typography.Title level={2}>导出书本</Typography.Title>
        <Typography.Paragraph type="secondary">
          整理成书信息，复制已接受的章节，或导出整本小说。
        </Typography.Paragraph>
      </div>
      {error && <Alert role="alert" type="error" showIcon message={error} />}{' '}
      {notice && <Alert role="status" type="success" showIcon message={notice} />}
      <Card title="书籍信息">
        <Space style={{ marginBottom: 16 }} wrap>
          {project?.cover && (
            <img
              src={coverImageUrl(projectId, project.cover.assetId, true)}
              alt="当前封面"
              style={{ width: 48, height: 64, objectFit: 'contain' }}
            />
          )}
          <Typography.Text type="secondary">
            {project?.cover
              ? '已设置封面，EPUB 将包含封面；TXT / Markdown 仅导出文字'
              : '未设置封面，可继续导出'}
          </Typography.Text>
          <Button
            onClick={() => {
              if (!dirty) {
                setViewedStage({ kind: 'cover' });
                return;
              }
              setNotice('请先保存成书信息，再前往管理封面');
            }}
          >
            管理封面
          </Button>
        </Space>
        <div className="book-fields">
          <label>
            书名（必填）
            <Input
              value={settings.title}
              maxLength={200}
              onChange={(e) => setField('title', e.target.value)}
            />
          </label>
          <label>
            作者（选填）
            <Input
              value={settings.author}
              maxLength={100}
              onChange={(e) => setField('author', e.target.value)}
            />
          </label>
        </div>
        <label className="book-intro">
          简介（选填）
          <Input.TextArea
            value={settings.introduction}
            maxLength={10000}
            rows={3}
            onChange={(e) => setField('introduction', e.target.value)}
          />
        </label>
        <Space>
          <Button
            loading={busy}
            disabled={!dirty || !settings.title.trim()}
            onClick={() =>
              void action(async () => {
                const s = await api.saveBookSettings(projectId, settings);
                setSettings(s);
                setSaved(JSON.stringify(s));
                setPreview(null);
                setNotice('成书信息已保存');
              })
            }
          >
            保存书籍信息
          </Button>
          <Typography.Text type="secondary">
            {dirty ? '有未保存修改，请先保存再预览' : '成书信息与项目名称独立'}
          </Typography.Text>
        </Space>
      </Card>
      <Card
        title="章节与预览"
        extra={
          <Button disabled={dirty} loading={busy} onClick={() => void previewChapter(selected)}>
            刷新预览与状态
          </Button>
        }
      >
        {!settings.chapters.length ? (
          <Empty description="尚无章目，请先完成大纲" />
        ) : (
          <div className="book-columns">
            <div>
              <List
                dataSource={settings.chapters}
                renderItem={(c) => (
                  <List.Item>
                    <div className="book-chapter">
                      <label>
                        第 {c.chapterNumber} 章
                        <Input
                          aria-label={`第 ${c.chapterNumber} 章展示标题`}
                          value={c.title}
                          onChange={(e) => titleChange(c.chapterNumber, e.target.value)}
                        />
                      </label>
                      {c.needsCheck && <Tag color="warning">大纲已更新，请核对标题后保存</Tag>}
                      <Button
                        size="small"
                        onClick={() => titleChange(c.chapterNumber, c.defaultTitle)}
                      >
                        恢复大纲章名
                      </Button>
                      <Space>
                        <Button
                          disabled={dirty || busy}
                          onClick={() =>
                            void previewChapter(c.chapterNumber, preview?.previewToken ?? undefined)
                          }
                        >
                          预览本章
                        </Button>
                        <span>
                          {preview?.chapters.find((p) => p.chapterNumber === c.chapterNumber)
                            ?.accepted
                            ? '已接受'
                            : '复制时校验接受状态'}
                        </span>
                      </Space>
                      <ChapterCopy projectId={projectId} chapterNumber={c.chapterNumber} />
                    </div>
                  </List.Item>
                )}
              />
            </div>
            <div className="book-reading" aria-label="书本预览">
              {preview ? (
                <>
                  <Typography.Title level={3}>{preview.metadata.title}</Typography.Title>
                  {preview.metadata.author && <p>{preview.metadata.author}</p>}
                  {preview.metadata.introduction && (
                    <p style={{ whiteSpace: 'pre-wrap' }}>{preview.metadata.introduction}</p>
                  )}
                  <h4>目录</h4>
                  <ol>
                    {preview.chapters.map((c) => (
                      <li key={c.chapterNumber}>{c.title}</li>
                    ))}
                  </ol>
                  {preview.selected ? (
                    <>
                      <h4>
                        第 {preview.selected.chapterNumber} 章 {preview.selected.title}
                      </h4>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{preview.selected.plain}</div>
                    </>
                  ) : (
                    <Empty description="本章尚无正文" />
                  )}
                </>
              ) : (
                <Empty description="保存信息后查看导出预览" />
              )}
            </div>
          </div>
        )}
        {preview?.diagnostics.map((d, i) => (
          <Alert
            key={i}
            type="warning"
            showIcon
            message={`${d.message}${d.line ? `（第 ${d.line} 行）` : ''}`}
            style={{ marginTop: 8 }}
          />
        ))}
      </Card>
      <Card title="整书导出">
        <Space direction="vertical">
          <Checkbox.Group
            options={[
              { label: 'TXT', value: 'txt' },
              { label: 'Markdown', value: 'markdown' },
              { label: 'EPUB', value: 'epub' },
            ]}
            value={formats}
            onChange={(v) => setFormats(v as BookFormat[])}
          />
          <Button
            type="primary"
            loading={busy}
            disabled={dirty || !preview?.previewToken || formats.length === 0}
            onClick={() =>
              void action(async () => {
                const token = preview!.previewToken!;
                const key = JSON.stringify([token, [...formats].sort()]);
                if (request.current?.key !== key)
                  request.current = { key, id: crypto.randomUUID() };
                await api.createBookJob(projectId, token, formats, request.current.id);
                request.current = null;
                await refreshJobs();
                setNotice('导出任务已创建，可以离开后返回查看');
              })
            }
          >
            生成整书文件
          </Button>
          {!preview?.previewToken && (
            <Typography.Text type="secondary">
              请先保存信息并预览；全部章节有效接受后即可导出。
            </Typography.Text>
          )}
        </Space>
      </Card>
      <Card title="导出历史" extra={<Button onClick={() => void refreshJobs()}>刷新记录</Button>}>
        {historyError && <Alert type="error" message={historyError} />}
        <List
          dataSource={jobs}
          locale={{ emptyText: '还没有导出记录' }}
          renderItem={(job) => (
            <List.Item>
              <div className="book-job">
                <Space wrap>
                  <strong>{job.title}</strong>
                  <Tag>{statusLabels[job.status]}</Tag>
                  <Tag>
                    {
                      {
                        current: '与当前内容一致',
                        historical: '历史版本',
                        unverifiable: '当前版本无法验证',
                      }[job.versionStatus]
                    }
                  </Tag>
                  <span>
                    {job.chapterCount} 章 · {new Date(job.createdAt).toLocaleString()}
                  </span>
                </Space>
                {job.error && <Alert type="warning" message={job.error} />}
                <Space wrap>
                  {job.files.map((f) => (
                    <Space key={f.format}>
                      <span>
                        {f.format.toUpperCase()}
                        {f.size != null ? ` · ${(f.size / 1024).toFixed(1)} KB` : ''}
                      </span>
                      {f.status === 'succeeded' ? (
                        <Button
                          disabled={busy || job.status === 'deleting'}
                          onClick={() =>
                            void action(async () => {
                              await api.downloadBook(projectId, job.id, f.format);
                            })
                          }
                        >
                          下载
                        </Button>
                      ) : f.status === 'failed' ? (
                        <Button
                          disabled={
                            busy || !['failed', 'partial_failed', 'succeeded'].includes(job.status)
                          }
                          onClick={() =>
                            void action(async () => {
                              await api.retryBookJob(projectId, job.id, [f.format]);
                              await refreshJobs();
                            })
                          }
                        >
                          重试 {f.format.toUpperCase()}
                        </Button>
                      ) : (
                        <Tag>{f.status === 'generating' ? '生成中' : '等待中'}</Tag>
                      )}
                      {f.error && <Typography.Text type="danger">{f.error}</Typography.Text>}
                    </Space>
                  ))}
                </Space>
                <Popconfirm
                  title="删除本次导出？"
                  description="将删除这次导出的快照和文件，正文不受影响。"
                  onConfirm={() =>
                    action(async () => {
                      await api.deleteBookJob(projectId, job.id);
                      await refreshJobs();
                    })
                  }
                >
                  <Button danger disabled={busy || job.status === 'deleting'}>
                    {job.status === 'delete_failed' ? '重试删除' : '删除记录'}
                  </Button>
                </Popconfirm>
              </div>
            </List.Item>
          )}
        />
        <Pagination
          current={page}
          pageSize={20}
          total={total}
          onChange={setPage}
          showSizeChanger={false}
        />
      </Card>
    </section>
  );
}
