import {
  GENRE_LABELS,
  LENGTH_LABELS,
  STAGES,
  STAGE_LABELS,
  type ArtifactStatus,
  type ProjectDetail,
  type QuestionnaireAnswers,
  type Stage,
} from '@rill/shared';

/** 阶段的聚合状态（与后端 UpstreamAssembler.readStageState 同口径） */
export interface StageState {
  status: ArtifactStatus;
  stale: boolean;
}

function aggregate(rows: Array<{ status: string; stale: boolean }>): StageState | undefined {
  if (rows.length === 0) return undefined;
  const allDone = rows.every((row) => row.status === 'done');
  const anyFailed = rows.some((row) => row.status === 'failed');
  const anyGenerating = rows.some((row) => row.status === 'generating');
  return {
    status: allDone ? 'done' : anyFailed ? 'failed' : anyGenerating ? 'generating' : 'pending',
    stale: rows.some((row) => row.stale),
  };
}

/** 读取某阶段的聚合产物状态；1:1 直读，1:N 按行聚合（任一 stale 即视为失效） */
export function readStageState(project: ProjectDetail, stage: Stage): StageState | undefined {
  if (project.stageStates?.[stage]) return project.stageStates[stage];
  if (stage === 'premise') {
    return project.premise
      ? { status: project.premise.status, stale: project.premise.stale }
      : undefined;
  }
  if (stage === 'world') {
    return project.world ? { status: project.world.status, stale: project.world.stale } : undefined;
  }
  if (stage === 'characters') return aggregate(project.characters);
  if (stage === 'relations') return aggregate(project.relations);
  return undefined;
}

/**
 * 本 change 范围内的三个阶段的生成上游（与后端各生成器的 requires() 保持一致；
 * characters 是否依赖 world 由类型的阶段列表决定——跳过世界观的类型只依赖种子）
 */
export function upstreamRequires(stage: Stage, projectStages: Stage[]): Stage[] {
  if (stage === 'outline')
    return [
      'premise',
      ...(projectStages.includes('world') ? ['world' as Stage] : []),
      'characters',
      'relations',
    ];
  if (stage === 'world') return ['premise'];
  if (stage === 'characters') {
    return projectStages.includes('world') ? ['premise', 'world'] : ['premise'];
  }
  if (stage === 'relations') return ['characters'];
  return [];
}

export type UpstreamBlockReason = 'missing' | 'not-done' | 'stale';

/** 找出第一个未就绪的上游阶段（缺失 / 未完成 / 已失效），用于生成前的阻塞提示 */
export function firstUnreadyUpstream(
  project: ProjectDetail,
  stage: Stage,
): { stage: Stage; reason: UpstreamBlockReason } | undefined {
  for (const up of upstreamRequires(stage, project.stages)) {
    const state = readStageState(project, up);
    if (!state) return { stage: up, reason: 'missing' };
    if (state.status !== 'done') return { stage: up, reason: 'not-done' };
    if (state.stale) return { stage: up, reason: 'stale' };
  }
  return undefined;
}

const BLOCK_REASON_LABELS: Record<UpstreamBlockReason, string> = {
  missing: '尚未生成',
  'not-done': '尚未完成',
  stale: '产物已失效，需重新生成',
};

/** 上游阻塞的提示文案 */
export function upstreamBlockLabel(block: { stage: Stage; reason: UpstreamBlockReason }): string {
  return `上游阶段「${STAGE_LABELS[block.stage]}」${BLOCK_REASON_LABELS[block.reason]}`;
}

/**
 * 轮询是否可以停：项目不在 running、当前阶段不在 generating。
 * auto 模式的阶段间隙（runAuto 先推进 currentStage 再触发 generating，
 * 瞬间会出现 idle + 当前阶段尚无产物行）视为未停，继续轮询直到链条终态。
 */
export function isPollingSettled(project: ProjectDetail): boolean {
  if (project.status === 'running') return false;
  const state = readStageState(project, project.currentStage);
  if (state?.status === 'generating') return false;
  if (project.mode === 'auto' && project.status === 'idle' && state === undefined) {
    return false;
  }
  return true;
}

/**
 * 本 change 范围内的阶段：种子 → 世界观 → 人物 → 关系 → 大纲
 * （按类型的阶段列表过滤，跳过的阶段不出现）
 */
export const IN_SCOPE_STAGES: Stage[] = [
  'premise',
  'world',
  'characters',
  'relations',
  'outline',
];

export function timelineStages(projectStages: Stage[]): Stage[] {
  return IN_SCOPE_STAGES.filter((stage) => projectStages.includes(stage));
}

/** 已实现的阶段（超出部分在时间轴上展示为「后续阶段」） */
export function isImplementedStage(stage: Stage): boolean {
  return IN_SCOPE_STAGES.includes(stage);
}

export function stageTokens(
  project: ProjectDetail,
  stage: Stage,
): { in: number; out: number } | undefined {
  const rows =
    stage === 'premise'
      ? [project.premise]
      : stage === 'world'
        ? [project.world]
        : stage === 'characters'
          ? project.characters
          : stage === 'relations'
            ? project.relations
            : [];
  const valid = rows.filter((row): row is NonNullable<(typeof rows)[number]> => row !== null);
  if (valid.length === 0) return undefined;
  return {
    in: valid.reduce((sum, row) => sum + row.promptTokens, 0),
    out: valid.reduce((sum, row) => sum + row.completionTokens, 0),
  };
}

/** 问卷已选维度的只读摘要（类型 · 篇幅 · 基调 · 视角） */
export function chosenDimensionsLabel(answers: QuestionnaireAnswers): string {
  return [
    GENRE_LABELS[answers.genre] ?? answers.genre,
    LENGTH_LABELS[answers.length] ?? answers.length,
    answers.tone,
    answers.pov,
  ].join(' · ');
}

/** 产物行的 token 用量摘要（mono 展示） */
export function formatTokens(tokens: { in: number; out: number }): string {
  return `${tokens.in.toLocaleString('en-US')} in / ${tokens.out.toLocaleString('en-US')} out`;
}

/** 阶段产物的最近更新时间（1:N 取各行最大值） */
export function stageUpdatedAt(project: ProjectDetail, stage: Stage): string | undefined {
  const rows =
    stage === 'premise'
      ? [project.premise]
      : stage === 'world'
        ? [project.world]
        : stage === 'characters'
          ? project.characters
          : stage === 'relations'
            ? project.relations
            : [];
  const times = rows
    .map((row) => row?.updatedAt)
    .filter((value): value is string => typeof value === 'string');
  if (times.length === 0) return undefined;
  return times.reduce((latest, value) => (value > latest ? value : latest));
}

/** 更新时间展示（今天/昨天 + 时分，或月-日） */
export function formatUpdatedAt(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff <= 0) return `今天 ${time}`;
  if (dayDiff === 1) return `昨天 ${time}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

/** 全部阶段（供类型引用与兜底） */
export const ALL_STAGES = STAGES;
