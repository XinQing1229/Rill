import { useEffect, useState } from 'react';
import { listProjects } from '../api/novel';

/** 侧栏「项目」角标：路由变化时轻量刷新（本地单用户工具，成本可忽略） */
export function useProjectCount(pathname: string): { count: number | undefined } {
  const [count, setCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((projects) => {
        if (!cancelled) setCount(projects.length);
      })
      .catch(() => {
        /* 侧栏角标失败不打扰主流程 */
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return { count };
}
