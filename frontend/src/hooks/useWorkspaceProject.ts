import { createContext, useContext } from 'react';
import type { ProjectDetail, Stage } from '@rill/shared';

/** 工作台页面向侧栏发布的当前项目与查看状态（侧栏据此渲染并切换「后续阶段」） */
export type WorkspaceView =
  { kind: 'stage'; stage: Stage } | { kind: 'book-export' } | { kind: 'cover' };
export interface WorkspaceProjectValue {
  project: ProjectDetail | null;
  setProject: (project: ProjectDetail | null) => void;
  /** 正在查看的阶段（null = 当前阶段） */
  viewedStage: WorkspaceView | null;
  setViewedStage: (stage: WorkspaceView | null) => void;
}

export const WorkspaceProjectContext = createContext<WorkspaceProjectValue>({
  project: null,
  setProject: () => {},
  viewedStage: null,
  setViewedStage: () => {},
});

export function useWorkspaceProject(): WorkspaceProjectValue {
  return useContext(WorkspaceProjectContext);
}
