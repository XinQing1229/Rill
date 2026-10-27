import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Empty, Image, Modal, Pagination, Skeleton, Space } from 'antd';
import {
  BookOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  SwapOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  COVER_DIMENSION_MESSAGE,
  COVER_FORMAT_MESSAGE,
  COVER_HISTORY_PAGE_SIZE,
  COVER_MAX_BYTES,
  COVER_MAX_EDGE_PX,
  COVER_MAX_TOTAL_PIXELS,
  COVER_SOURCE_MIME_TYPES,
  COVER_TOO_LARGE_MESSAGE,
  type CoverAsset,
  type CoverHistoryPage,
  type ProjectCoverState,
} from '@rill/shared';
import * as api from '../../api/cover';
import { ApiError } from '../../api/client';
import './CoverWorkbench.css';

export function CoverWorkbench({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => Promise<unknown>;
}) {
  const { message, modal } = App.useApp();
  const [state, setState] = useState<ProjectCoverState | null>(null);
  const [history, setHistory] = useState<CoverHistoryPage | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const historyRequest = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{
    file: File;
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const [detail, setDetail] = useState<CoverAsset | null>(null);
  const [preview, setPreview] = useState(false);
  const refreshHistory = useCallback(async () => {
    const requestId = ++historyRequest.current;
    try {
      const result = await api.getCoverHistory(projectId, page);
      if (requestId === historyRequest.current) {
        setHistory(result);
        setHistoryError('');
      }
    } catch (e) {
      if (requestId === historyRequest.current)
        setHistoryError(e instanceof Error ? e.message : '历史读取失败');
    }
  }, [projectId, page]);
  const refresh = useCallback(async () => {
    try {
      setState(await api.getCover(projectId));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '封面读取失败');
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);
  useEffect(
    () => () => {
      if (draft) URL.revokeObjectURL(draft.url);
    },
    [draft],
  );
  useEffect(() => {
    if (!draft && !busy) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', prevent);
    // 应用内导航也须避免静默丢失待保存的选图。
    const guard = (event: MouseEvent) => {
      const target =
        event.target instanceof Element ? event.target.closest('a, .side-stage') : null;
      if (target instanceof HTMLAnchorElement && target.hasAttribute('download')) return;
      if (target) {
        event.preventDefault();
        event.stopPropagation();
        void message.info('请先保存或取消当前封面操作');
      }
    };
    document.addEventListener('click', guard, true);
    return () => {
      window.removeEventListener('beforeunload', prevent);
      document.removeEventListener('click', guard, true);
    };
  }, [draft, busy, message]);
  const action = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await refresh();
        await refreshHistory();
      }
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const changed = async (next: ProjectCoverState) => {
    setState(next);
    setDetail(null);
    setPage(1);
    // 切回第一页时 effect 刷新，否则直接刷新当前页。
    if (page === 1) await refreshHistory();
    await onChanged();
  };
  const choose = async (file: File) => {
    if (file.size > COVER_MAX_BYTES) {
      void message.error(COVER_TOO_LARGE_MESSAGE);
      return;
    }
    if (!COVER_SOURCE_MIME_TYPES.some((mime) => mime === file.type)) {
      void message.error(COVER_FORMAT_MESSAGE);
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new window.Image();
      img.src = url;
      await img.decode();
      if (
        Math.max(img.naturalWidth, img.naturalHeight) > COVER_MAX_EDGE_PX ||
        img.naturalWidth * img.naturalHeight > COVER_MAX_TOTAL_PIXELS
      )
        throw new Error(COVER_DIMENSION_MESSAGE);
      setDraft({ file, url, width: img.naturalWidth, height: img.naturalHeight });
    } catch (e) {
      URL.revokeObjectURL(url);
      void message.error(e instanceof Error ? e.message : '图片无法解码');
    }
  };
  const discard = () => {
    if (busy) return;
    modal.confirm({
      title: '放弃这张尚未保存的封面？',
      okText: '放弃',
      cancelText: '继续编辑',
      onOk: () => setDraft(null),
    });
  };
  const current = state?.currentCover;
  const available = current?.fileStatus === 'available';
  if (!state && !error) return <Skeleton active paragraph={{ rows: 8 }} />;
  return (
    <section className="cover-workbench" aria-label="封面管理">
      {error && (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={error}
          action={!state ? <Button onClick={() => void refresh()}>重试</Button> : undefined}
        />
      )}
      <input
        ref={picker}
        type="file"
        accept={COVER_SOURCE_MIME_TYPES.join(',')}
        aria-label="选择封面图片"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void choose(file);
        }}
      />
      <div className="cover-main-card">
        <div className="cover-current">
          <h2>当前封面</h2>
          <div className="cover-current-image">
            {available ? (
              <Image
                src={api.coverImageUrl(projectId, current.id)}
                alt="当前小说封面"
                preview={{ visible: preview, onVisibleChange: setPreview }}
                onError={() => {
                  setState((s) =>
                    s?.currentCover
                      ? { ...s, currentCover: { ...s.currentCover, fileStatus: 'corrupt' } }
                      : s,
                  );
                }}
              />
            ) : (
              <div className="cover-empty">
                <BookOutlined />
                <span>{current ? '封面文件不可用' : '尚未设置封面'}</span>
              </div>
            )}
          </div>
        </div>
        <div className="cover-settings">
          <h2>封面设置</h2>
          <p>上传合适的封面作为小说的封面，用于项目展示和 EPUB 导出。</p>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            disabled={!state || busy}
            onClick={() => picker.current?.click()}
          >
            上传新封面
          </Button>
          <div className="cover-rules">
            <div>推荐尺寸：1200 × 1600 像素（3:4 比例）</div>
            <div>支持格式：JPG、PNG、WebP</div>
            <div>文件大小：不超过 {COVER_MAX_BYTES / 1_000_000} MB</div>
          </div>
          <div className="cover-tools">
            <Button
              icon={<EyeOutlined />}
              disabled={!available || busy}
              onClick={() => setPreview(true)}
            >
              预览大图
            </Button>
            <Button
              icon={<SwapOutlined />}
              disabled={!current || busy}
              onClick={() => picker.current?.click()}
            >
              更换封面
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={!available || busy}
              onClick={() => current && void action(() => api.downloadCover(projectId, current.id))}
            >
              下载封面
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={!current || busy}
              onClick={() =>
                modal.confirm({
                  title: '删除当前封面？',
                  content:
                    '项目将恢复默认占位，该图片也会从封面历史中移除。已生成的历史导出不受影响。',
                  okText: '删除封面',
                  okButtonProps: { danger: true },
                  cancelText: '取消',
                  onOk: () =>
                    action(async () => {
                      await changed(await api.deleteCover(projectId, current!.id, state!.revision));
                      void message.success('封面已删除');
                    }),
                })
              }
            >
              删除封面
            </Button>
          </div>
          <p className="cover-note">请上传已包含所需书名与作者文字的成品图片。</p>
        </div>
      </div>
      <div className="cover-history-card">
        <div className="cover-history-heading">
          <h2>封面历史</h2>
          <span>
            {history ? `共 ${history.total} 张封面` : historyError ? '读取失败' : '正在读取'}
          </span>
        </div>
        {historyError ? (
          <Alert
            type="error"
            message={historyError}
            action={<Button onClick={() => void refreshHistory()}>重试</Button>}
          />
        ) : !history ? (
          <Skeleton active />
        ) : !history.items.length ? (
          <Empty description="暂无封面历史，上传封面后将在这里保留记录" />
        ) : (
          <>
            {!current && <p className="cover-note">可从历史中选择一张设为当前封面。</p>}
            <div className="cover-history-grid">
              {history.items.map((asset) => (
                <div key={asset.id} className="cover-history-item">
                  <button
                    className={`cover-history-image ${asset.isCurrent ? 'is-current' : ''}`}
                    aria-label={`${asset.isCurrent ? '当前使用，' : ''}查看封面 ${asset.originalFilename}`}
                    onClick={() => setDetail(asset)}
                    disabled={busy}
                  >
                    {asset.fileStatus === 'available' ? (
                      <img
                        loading="lazy"
                        src={api.coverImageUrl(projectId, asset.id, true)}
                        alt={asset.originalFilename}
                      />
                    ) : (
                      <span>封面文件不可用</span>
                    )}
                    {asset.isCurrent && <span className="cover-current-badge">当前使用</span>}
                  </button>
                  <time dateTime={asset.createdAt}>
                    {new Date(asset.createdAt).toLocaleString('sv-SE').slice(0, 16)}
                  </time>
                </div>
              ))}
            </div>
            {history.total > COVER_HISTORY_PAGE_SIZE && (
              <Pagination
                current={page}
                pageSize={COVER_HISTORY_PAGE_SIZE}
                total={history.total}
                showSizeChanger={false}
                onChange={setPage}
              />
            )}
          </>
        )}
      </div>
      <Modal
        title="上传封面"
        open={!!draft}
        onCancel={discard}
        maskClosable={!busy}
        closable={!busy}
        keyboard={!busy}
        footer={
          <Space>
            <Button disabled={busy} onClick={() => picker.current?.click()}>
              重新选择
            </Button>
            <Button disabled={busy} onClick={discard}>
              取消
            </Button>
            <Button
              type="primary"
              loading={busy}
              onClick={() =>
                draft &&
                state &&
                void action(async () => {
                  const next = await api.uploadCover(projectId, draft.file, state.revision);
                  setDraft(null);
                  await changed(next);
                  void message.success('封面已保存');
                })
              }
            >
              保存并使用
            </Button>
          </Space>
        }
      >
        {draft && (
          <div className="cover-upload-preview">
            <img src={draft.url} alt="待保存封面" />
            <p>{draft.file.name}</p>
            <p>
              {draft.width} × {draft.height} 像素 · {(draft.file.size / 1_000_000).toFixed(2)} MB
            </p>
            {(draft.width < 1200 ||
              draft.height < 1600 ||
              Math.abs(draft.width / draft.height - 0.75) > 0.02) && (
              <Alert
                type="info"
                message="建议使用 1200 × 1600 的 3:4 图片；仍可保存，图片不会被裁切。"
              />
            )}
            <p>
              保存时会规范化图片{draft.file.type === 'image/webp' ? '，WebP 将保存为 PNG' : ''}。
            </p>
            {error && <Alert type="error" message={error} />}
          </div>
        )}
      </Modal>
      <Modal
        title="封面详情"
        open={!!detail}
        onCancel={() => !busy && setDetail(null)}
        footer={
          detail && (
            <Space>
              <Button
                disabled={busy || detail.fileStatus !== 'available'}
                icon={<DownloadOutlined />}
                onClick={() => void action(() => api.downloadCover(projectId, detail.id))}
              >
                下载封面
              </Button>
              <Button
                type="primary"
                disabled={busy || detail.fileStatus !== 'available' || detail.id === current?.id}
                loading={busy}
                onClick={() =>
                  state &&
                  void action(async () => {
                    await changed(await api.activateCover(projectId, detail.id, state.revision));
                    void message.success('已切换当前封面');
                  })
                }
              >
                {detail.id === current?.id ? '当前使用' : '设为当前封面'}
              </Button>
            </Space>
          )
        }
      >
        {detail && (
          <div className="cover-upload-preview">
            {detail.fileStatus === 'available' ? (
              <Image src={api.coverImageUrl(projectId, detail.id)} alt={detail.originalFilename} />
            ) : (
              <Alert type="error" message="封面文件不可用" />
            )}
            <p>{detail.originalFilename}</p>
            <p>
              {detail.width} × {detail.height} · {detail.mimeType} ·{' '}
              {(detail.size / 1_000_000).toFixed(2)} MB
            </p>
            <p>上传时间：{new Date(detail.createdAt).toLocaleString()}</p>
            {error && <Alert type="error" message={error} />}
          </div>
        )}
      </Modal>
    </section>
  );
}
