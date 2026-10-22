import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectDetail } from '@rill/shared';
import { getProject } from '../api/novel';
import { isPollingSettled } from '../lib/stage';

const POLL_MS = 1500;

export interface ProjectState {
  project: ProjectDetail | null;
  error: string | null;
  loading: boolean;
  /** 手动刷新一次（不重启轮询周期） */
  refresh: () => Promise<ProjectDetail | null>;
  /** 操作后调用：重新拉取并按最新状态决定是否继续轮询 */
  restartPolling: () => void;
}

/**
 * 项目详情 + 条件轮询：
 * 阶段生成中（status=running 或当前阶段 generating）以 1.5s 轮询，落定即停；
 * auto 模式的阶段间隙继续轮询，直到链条终态（done/failed）。
 */
export function useProject(id: string | undefined): ProjectState {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const projectRef = useRef<ProjectDetail | null>(null);

  const refresh = useCallback(async (): Promise<ProjectDetail | null> => {
    if (!id) return null;
    try {
      const data = await getProject(id);
      projectRef.current = data;
      setProject(data);
      setError(null);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      projectRef.current = null;
      setProject(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const data = await refresh();
      if (cancelled) return;
      if (data && !isPollingSettled(data)) {
        timer = setTimeout(() => void tick(), POLL_MS);
      }
    };
    if (!projectRef.current) setLoading(true);
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, refresh, epoch]);

  const restartPolling = useCallback(() => setEpoch((value) => value + 1), []);

  return { project, error, loading, refresh, restartPolling };
}
