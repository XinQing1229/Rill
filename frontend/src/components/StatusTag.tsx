import type { ProjectStatus } from '@rill/shared';
import { tokens } from '../theme';

/** 项目状态 pill：浅底深字同色对（app-screen 规则） */
const STATUS_STYLES: Record<ProjectStatus, { label: string; background: string; color: string }> = {
  idle: { label: '待操作', background: tokens.active, color: '#353736' },
  running: { label: '生成中', background: '#e3f0f3', color: '#155a6a' },
  done: { label: '已完成', background: '#dcfae5', color: '#04250e' },
  failed: { label: '失败', background: '#ffedea', color: '#831c1e' },
};

export function StatusTag({ status }: { status: ProjectStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className="pill" style={{ background: style.background, color: style.color }}>
      {style.label}
    </span>
  );
}
