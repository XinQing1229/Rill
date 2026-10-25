import { useState } from 'react';
import { PremiseRevisionCard } from '../premise/PremiseRevisionCard';
import { ProseWorkbench } from '../prose/ProseWorkbench';
import { OutlineWorkbench } from '../outline/OutlineWorkbench';
import { Alert, Button, Popconfirm, Skeleton } from 'antd';
import type { ZodType } from 'zod';
import {
  PremiseReadSchema,
  STAGE_LABELS,
  worldSchemaFor,
  type ProjectDetail,
  type Stage,
} from '@rill/shared';
import { PremiseView } from '../premise/PremiseView';
import { WorldView } from '../world/WorldView';
import { CharacterView } from '../characters/CharacterView';
import { RelationList } from '../characters/RelationList';
import {
  firstUnreadyUpstream,
  formatTokens,
  formatUpdatedAt,
  isImplementedStage,
  readStageState,
  stageTokens,
  stageUpdatedAt,
  upstreamBlockLabel,
  type StageState,
} from '../../lib/stage';

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

type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** 产物数据按 shared schema 校验后解析；坏数据展示错误而不崩溃 */
function parseData<T>(
  schema: ZodType<T>,
  row: { data: string } | null | undefined,
): ParseResult<T> | null {
  if (!row) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(row.data));
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, error: '产物结构不符合契约定义，无法展示' };
  } catch {
    return { ok: false, error: '产物数据不是合法 JSON，无法展示' };
  }
}

interface Props {
  project: ProjectDetail;
  stage: Stage;
  busy: boolean;
  onBusyChange?: (busy: boolean) => void;
  onOutlineRefresh?: () => void;
  onGenerate: (force: boolean) => void | Promise<void>;
  onConfirm: () => void;
  onRollback: (stage: Stage) => void;
}

/** 阶段面板：按状态分流（待生成 / 生成中 / 已完成 / 失败 / 已失效） */
export function StagePanel({
  project,
  stage,
  busy: parentBusy,
  onBusyChange,
  onGenerate,
  onConfirm,
  onRollback,
  onOutlineRefresh,
}: Props) {
  const [revisionBusy, setRevisionBusy] = useState(false);
  const busy = parentBusy || revisionBusy || project.status === 'running';
  const revisionBusyChanged = (value: boolean) => {
    setRevisionBusy(value);
    onBusyChange?.(value);
  };
  if (stage === 'prose')
    return (
      <ProseWorkbench
        key={project.id}
        project={project}
        busy={busy}
        onGenerate={onGenerate}
        onChanged={onOutlineRefresh}
      />
    );
  if (stage === 'outline')
    return (
      <OutlineWorkbench
        project={project}
        onChanged={onOutlineRefresh}
        onRollback={() => onRollback('outline')}
      />
    );
  if (!isImplementedStage(stage)) {
    return (
      <div className="node">
        <header>
          <h2>{STAGE_LABELS[stage]}</h2>
        </header>
        <div className="node-sub">该阶段暂未开放，将在后续 change 中开放。</div>
      </div>
    );
  }

  const state = readStageState(project, stage);
  const tokens = stageTokens(project, stage);
  const isCurrent = stage === project.currentStage;
  const status: StageState['status'] = state?.status ?? 'pending';
  const stale = state?.stale ?? false;
  const updatedAt = stageUpdatedAt(project, stage);

  const renderArtifact = () => {
    if (stage === 'premise') {
      const parsed = parseData(PremiseReadSchema, project.premise);
      if (parsed === null) return null;
      return parsed.ok ? (
        <PremiseView premise={parsed.data} />
      ) : (
        <Alert type="error" showIcon message={parsed.error} />
      );
    }
    if (stage === 'world') {
      // worldSchemaFor 合并通用骨架与自定义块，联合类型复杂，这里显式收窄为 Record
      const worldSchema = worldSchemaFor(project.genre) as unknown as ZodType<
        Record<string, unknown>
      >;
      const parsed = parseData(worldSchema, project.world);
      if (parsed === null) return null;
      if (!parsed.ok) return <Alert type="error" showIcon message={parsed.error} />;
      const premiseParsed = parseData(PremiseReadSchema, project.premise);
      return (
        <WorldView
          world={parsed.data as Record<string, unknown>}
          genre={project.genre}
          premiseSetting={premiseParsed?.ok ? premiseParsed.data.setting : undefined}
        />
      );
    }
    if (stage === 'characters') {
      // 关系网由紧随其后的 relations 阶段独立展示，这里不再重复渲染
      return <CharacterView rows={project.characters} />;
    }
    if (stage === 'relations') {
      const nameOf = (cid: string) =>
        project.characters.find((row) => row.id === cid)?.name ?? '（已删除人物）';
      return (
        <div>
          <div className="block-title">
            <h3>关系网</h3>
            <span className="meta">{project.relations.length} 条 · 依赖人物产物</span>
          </div>
          <RelationList relations={project.relations} nameOf={nameOf} />
        </div>
      );
    }
    return null;
  };

  return (
    <div className="node">
      <header>
        <h2>
          {STAGE_LABELS[stage]}
          {stage === 'characters' && project.characters.length > 0 && (
            <span className="num" style={{ fontWeight: 400, color: 'var(--faint)' }}>
              {' '}
              {project.characters.length} 位
            </span>
          )}
          {stage === 'relations' && project.relations.length > 0 && (
            <span className="num" style={{ fontWeight: 400, color: 'var(--faint)' }}>
              {' '}
              {project.relations.length} 条
            </span>
          )}
        </h2>
        <StageStatePill state={state} />
        <span className="node-meta">
          {tokens && updatedAt ? (
            <>
              生成于 {formatUpdatedAt(updatedAt)} ·{' '}
              <span className="mono num">{formatTokens(tokens)}</span>
            </>
          ) : (
            '尚未生成'
          )}
        </span>
        <div className="actions">
          {(status === 'failed' || (status === 'done' && stale)) && (
            <Button size="small" type="primary" loading={busy} onClick={() => onGenerate(true)}>
              重新生成
            </Button>
          )}
        </div>
      </header>

      {(status === 'pending' || state === undefined) && (
        <div>
          {(() => {
            const block = firstUnreadyUpstream(project, stage);
            if (block) {
              // 上游未就绪：阻止生成（不发起请求），说明原因
              return (
                <Alert
                  type="warning"
                  showIcon
                  message="暂不能生成"
                  description={`${upstreamBlockLabel(block)}。完成后才能生成${STAGE_LABELS[stage]}。`}
                />
              );
            }
            return (
              <Button type="primary" loading={busy} onClick={() => onGenerate(false)}>
                生成{STAGE_LABELS[stage]}
              </Button>
            );
          })()}
        </div>
      )}

      {status === 'generating' && (
        <div aria-busy="true">
          <Skeleton active paragraph={{ rows: 5 }} />
          <div className="hint">生成中，进度每 1.5 秒自动刷新…</div>
        </div>
      )}

      {status === 'failed' && (
        <Alert
          type="error"
          showIcon
          message="生成失败"
          description={(() => {
            const row =
              stage === 'premise'
                ? project.premise
                : stage === 'world'
                  ? project.world
                  : (project.characters.find((item) => item.error !== null) ??
                    project.relations.find((item) => item.error !== null));
            return project.stageStates?.[stage]?.error ?? row?.error ?? '未知错误';
          })()}
          style={{ marginBottom: 12 }}
        />
      )}

      {status === 'done' && stale && (
        <Alert
          type="warning"
          showIcon
          message="产物已失效"
          description="上游阶段发生了回退或重新生成，请重新生成后再确认。"
          style={{ marginBottom: 12 }}
        />
      )}

      {status === 'done' && (
        <>
          {renderArtifact()}
          <div className="block-title" style={{ marginTop: 20 }}>
            <span style={{ fontSize: 'var(--fs-small)', color: 'var(--muted)', fontWeight: 400 }}>
              阶段操作
            </span>
            <span style={{ flex: 1 }} />
            {isCurrent &&
              !stale &&
              (project.mode === 'manual' ||
                (stage === 'premise' && project.stageStates?.premise?.confirmedAt === null)) && (
                <Button type="primary" disabled={busy} onClick={onConfirm}>
                  确认并推进
                </Button>
              )}
            <Popconfirm
              title="重新生成将覆盖已有产物"
              description="其后阶段的产物也会标记为失效，确定继续？"
              okText="重新生成"
              cancelText="取消"
              disabled={busy}
              onConfirm={() => onGenerate(true)}
            >
              <Button size="small" disabled={busy}>
                重新生成
              </Button>
            </Popconfirm>
            {!isCurrent && (
              <Popconfirm
                title={`回退到「${STAGE_LABELS[stage]}」`}
                description="其后的阶段产物将被标记为失效，需要重新生成。确定回退？"
                okText="回退"
                cancelText="取消"
                disabled={busy}
                onConfirm={() => onRollback(stage)}
              >
                <Button size="small" disabled={busy}>
                  回退到此阶段
                </Button>
              </Popconfirm>
            )}
          </div>
          {stage === 'premise' && !stale && (
            <PremiseRevisionCard
              key={project.id}
              project={project}
              busy={parentBusy || project.status === 'running'}
              onBusyChange={revisionBusyChanged}
              onChanged={onOutlineRefresh}
            />
          )}
        </>
      )}
    </div>
  );
}
