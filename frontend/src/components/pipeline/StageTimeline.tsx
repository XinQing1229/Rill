import { STAGE_LABELS, type ProjectDetail, type Stage } from '@rill/shared';
import { formatTokens, readStageState, stageTokens, timelineStages, type StageState } from '../../lib/stage';

/** 阶段状态 pill：状态优先，done 上再区分失效 */
export function StageStatePill({ state }: { state: StageState | undefined }) {
  let label = '待生成';
  let background = 'var(--active)';
  let color = '#353736';
  if (state) {
    if (state.status === 'generating') {
      label = '生成中';
      background = '#e3f0f3';
      color = '#155a6a';
    } else if (state.status === 'failed') {
      label = '失败';
      background = '#ffedea';
      color = '#831c1e';
    } else if (state.status === 'done') {
      if (state.stale) {
        label = '已失效';
        background = '#fffbeb';
        color = '#92400e';
      } else {
        label = '已完成';
        background = '#dcfae5';
        color = '#04250e';
      }
    }
  }
  return (
    <span className="pill" style={{ background, color }}>
      {label}
    </span>
  );
}

interface Props {
  project: ProjectDetail;
  /** null 表示看当前阶段 */
  viewedStage: Stage | null;
  onSelect: (stage: Stage | null) => void;
  /** 脊线间隙的「确认并推进」按钮（由页面决定是否可用） */
  advance?: { disabled: boolean; onClick: () => void };
}

/** 阶段脊线：小说一阶段一阶段长出来（种子 → 世界观 → 人物，按类型跳过的阶段不出现） */
export function StageTimeline({ project, viewedStage, onSelect, advance }: Props) {
  const stages = timelineStages(project.stages);

  return (
    <div className="spine">
      {stages.map((stage) => {
        const state = readStageState(project, stage);
        const isCurrent = stage === project.currentStage;
        const tokens = stageTokens(project, stage);
        const cls = [
          'stage',
          'clickable',
          state?.status ?? 'pending',
          isCurrent ? 'current' : '',
          viewedStage === stage || (viewedStage === null && isCurrent) ? 'viewed' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={stage}
            className={cls}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(isCurrent ? null : stage)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelect(isCurrent ? null : stage);
            }}
          >
            <span className="dot" />
            <div className="st-key">{stage}</div>
            <div className="st-name">{STAGE_LABELS[stage]}</div>
            <div className="st-sub">
              <StageStatePill state={state} />
            </div>
            {tokens && <div className="st-tokens num">{formatTokens(tokens)}</div>}
          </div>
        );
      })}

      {advance !== undefined && (
        <div className="stage-advance">
          <button
            type="button"
            className="insert"
            style={
              advance.disabled
                ? undefined
                : { background: 'var(--primary)', borderColor: 'transparent', color: 'var(--primary-ink)' }
            }
            disabled={advance.disabled}
            aria-label="确认并推进下一阶段"
            title="确认并推进下一阶段"
            onClick={advance.onClick}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 2.5v9M3.5 8 7 11.5 10.5 8" />
            </svg>
          </button>
          <span className="insert-label">确认并推进下一阶段</span>
        </div>
      )}

      {/* 后续阶段：本 change 范围外，置灰预告 */}
      <div className="stage" style={{ paddingTop: advance !== undefined ? 0 : 8 }}>
        <span className="dot" style={{ borderStyle: 'dashed' }} />
        <div className="st-key">outline → prose</div>
        <div className="st-name" style={{ color: 'var(--faint)' }}>
          后续阶段
        </div>
        <div className="st-sub">大纲 · 细纲 · 正文，即将开放</div>
      </div>
    </div>
  );
}
