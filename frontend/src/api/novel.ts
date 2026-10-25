import { PremisePreviewSchema } from '@rill/shared';
import type { PreviewPremiseBody, PremisePreview } from '@rill/shared';
import type { OutlineDetail, OutlinePlan, ChapterSummary, OutlineConfirm } from '@rill/shared';
import type { z } from 'zod';
import type {
  CharacterRow,
  ConfirmAction,
  GenerateResponse,
  Genre,
  PipelineMode,
  ProjectDetail,
  ProjectScope,
  ProjectSummary,
  QuestionnaireAnswers,
  QuestionnaireDefinition,
  RelationRow,
  Stage,
} from '@rill/shared';
import { CreateProjectSchema, GenerateBodySchema } from '@rill/shared';
import { del, get, post, patch } from './client';

type CreateProjectBody = z.infer<typeof CreateProjectSchema>;
type GenerateBody = z.infer<typeof GenerateBodySchema>;

const base = '/api/novel';

/** 获取问卷结构（随类型级联） */
export function getQuestionnaire(genre: Genre): Promise<QuestionnaireDefinition> {
  return get(`${base}/questionnaire?genre=${encodeURIComponent(genre)}`);
}

/** 创建项目并返回详情（含初始 premise 行） */
export function createProject(body: CreateProjectBody): Promise<ProjectDetail> {
  return post(`${base}/projects`, body);
}

/** 项目列表（scope=trash 时为回收站，按删除时间倒序） */
export function listProjects(scope: ProjectScope = 'active'): Promise<ProjectSummary[]> {
  return get(`${base}/projects${scope === 'trash' ? '?scope=trash' : ''}`);
}

/** 软删除：移入回收站，产物保留可恢复 */
export function deleteProject(id: string): Promise<ProjectSummary> {
  return del(`${base}/projects/${id}`);
}

/** 从回收站恢复 */
export function restoreProject(id: string): Promise<ProjectDetail> {
  return post(`${base}/projects/${id}/restore`);
}

/** 永久删除回收站项目（不可恢复） */
export function purgeProject(id: string): Promise<{ id: string; purged: boolean }> {
  return del(`${base}/projects/${id}/permanent`);
}

/** 清空回收站 */
export function clearTrash(): Promise<{ removed: number }> {
  return del(`${base}/projects?scope=trash`);
}

/** 项目详情（含各阶段产物行与完整阶段列表） */
export function getProject(id: string): Promise<ProjectDetail> {
  return get(`${base}/projects/${id}`);
}

/** 触发阶段生成；auto 模式下触发连续推进（响应带 auto: true） */
export function generateStage(id: string, body: GenerateBody = {}): Promise<GenerateResponse> {
  return post(`${base}/projects/${id}/generate`, body);
}

/**
 * 确认当前阶段：恢复流水线图执行并生成下一阶段。
 * action 为 regenerate 时重新生成本阶段而非推进。
 */
export function confirmStage(id: string, action?: ConfirmAction): Promise<ProjectDetail> {
  return post(`${base}/projects/${id}/confirm`, {
    ...(action ? { action } : {}),
  });
}

/** 回退到指定阶段（其后的阶段产物标记失效） */
export function rollbackStage(id: string, stage: Stage): Promise<ProjectDetail> {
  return post(`${base}/projects/${id}/rollback`, { stage });
}

/** 切换推进模式 */
export function setMode(id: string, mode: PipelineMode): Promise<ProjectDetail> {
  return post(`${base}/projects/${id}/mode`, { mode });
}

/** 人物列表（含状态） */
export function listCharacters(id: string): Promise<CharacterRow[]> {
  return get(`${base}/projects/${id}/characters`);
}

/** 关系列表（含双方标识、类型与相对角色） */
export function listRelations(id: string): Promise<RelationRow[]> {
  return get(`${base}/projects/${id}/relations`);
}

/** 解析项目详情里的问卷答案 JSON 字符串 */
export function parseAnswers(project: ProjectDetail): QuestionnaireAnswers {
  try {
    return JSON.parse(project.answers) as QuestionnaireAnswers;
  } catch {
    throw new Error('问卷答案数据损坏，无法解析');
  }
}

export function getOutline(id: string): Promise<OutlineDetail> {
  return get(`${base}/projects/${id}/outline`);
}

export function configureOutline(
  id: string,
  expectedRevision: number,
  targetChapters: number,
): Promise<OutlineDetail> {
  return patch(`${base}/projects/${id}/outline/config`, { expectedRevision, targetChapters });
}
export function saveOutlinePlan(
  id: string,
  expectedRevision: number,
  plan: OutlinePlan,
): Promise<OutlineDetail> {
  return patch(`${base}/projects/${id}/outline/plan`, { expectedRevision, plan });
}
export function saveOutlineChapter(
  id: string,
  expectedRevision: number,
  chapter: ChapterSummary,
): Promise<OutlineDetail> {
  return patch(`${base}/projects/${id}/outline/chapters/${chapter.number}`, {
    expectedRevision,
    chapter,
  });
}
export function confirmOutline(id: string, confirmation: OutlineConfirm): Promise<ProjectDetail> {
  return post(`${base}/projects/${id}/confirm`, confirmation);
}

export function getProse(id: string): Promise<import('@rill/shared').ProseDetail> {
  return get(`${base}/projects/${id}/prose`);
}
export function proseChapterAction(
  id: string,
  number: number,
  action: 'retry' | 'override' | 'confirm' | 'restore',
  body: unknown = {},
): Promise<import('@rill/shared').ProseDetail> {
  return post(`${base}/projects/${id}/prose/chapters/${number}/${action}`, body);
}

/** 建议修改只生成候选，不改变正式种子或推进位置。 */
export async function previewPremise(
  id: string,
  body: PreviewPremiseBody,
): Promise<PremisePreview> {
  return PremisePreviewSchema.parse(await post(`${base}/projects/${id}/premise/preview`, body));
}

export function adoptPremise(id: string, candidateId: string): Promise<ProjectDetail> {
  return post(`${base}/projects/${id}/premise/adopt`, { candidateId });
}

export function createProseRevision(
  id: string,
  number: number,
  body: import('@rill/shared').CreateProseRevisionBody,
): Promise<import('@rill/shared').ProseRevision> {
  return post(`${base}/projects/${id}/prose/chapters/${number}/revisions`, body);
}
export function getProseRevision(
  id: string,
  number: number,
  revisionId: string,
): Promise<import('@rill/shared').ProseRevision> {
  return get(`${base}/projects/${id}/prose/chapters/${number}/revisions/${revisionId}`);
}
export function applyProseRevision(
  id: string,
  number: number,
  revisionId: string,
  body: import('@rill/shared').ApplyProseRevisionBody,
): Promise<import('@rill/shared').ProseRevision> {
  return post(
    `${base}/projects/${id}/prose/chapters/${number}/revisions/${revisionId}/apply`,
    body,
  );
}
export function discardProseRevision(
  id: string,
  number: number,
  revisionId: string,
): Promise<import('@rill/shared').ProseRevision> {
  return post(`${base}/projects/${id}/prose/chapters/${number}/revisions/${revisionId}/discard`);
}
