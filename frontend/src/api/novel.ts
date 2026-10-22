import type { z } from 'zod';
import type {
  CharacterRow,
  ConfirmAction,
  GenerateResponse,
  Genre,
  PipelineMode,
  ProjectDetail,
  ProjectSummary,
  QuestionnaireAnswers,
  QuestionnaireDefinition,
  RelationRow,
  Stage,
} from '@rill/shared';
import { CreateProjectSchema, GenerateBodySchema } from '@rill/shared';
import { get, post } from './client';

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

/** 项目列表（按更新时间倒序） */
export function listProjects(): Promise<ProjectSummary[]> {
  return get(`${base}/projects`);
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
  return post(`${base}/projects/${id}/confirm`, action ? { action } : {});
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
