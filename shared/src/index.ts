import { z } from 'zod';

/**
 * Rill 前后端共享的 API 契约类型与结构定义。
 */

/** GET /api/health 响应 */
export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

/** POST /api/llm/ping 响应 */
export interface PingResponse {
  ok: boolean;
  model: string;
  content: string;
}

/**
 * 中性的结构化输出验证 schema（非小说领域结构）——
 * 仅用于验证 AI 基建的结构化输出链路，领域 schema 留给后续 change。
 */
export const SampleBookSchema = z.object({
  title: z.string().describe('书名'),
  summary: z.string().describe('一句话简介'),
  tags: z.array(z.string()).describe('标签'),
});

export type SampleBook = z.infer<typeof SampleBookSchema>;

// ---------------- 创作流水线 ----------------

export const GENRES = [
  'xuanhuan',
  'dushi',
  'xuanyi',
  'lishi',
  'kehuan',
  'yanqing',
  'other',
] as const;
export type Genre = (typeof GENRES)[number];

export const LENGTHS = ['short', 'medium', 'long'] as const;
export type StoryLength = (typeof LENGTHS)[number];

export const TONES = ['轻松', '热血', '治愈', '暗黑', '紧张', '厚重'] as const;
export const POVS = ['第一人称', '第三人称限知', '第三人称全知'] as const;

export const PIPELINE_MODES = ['manual', 'auto'] as const;
export type PipelineMode = (typeof PIPELINE_MODES)[number];

export const STAGES = ['premise', 'world', 'characters', 'outline', 'beats', 'prose'] as const;
export type Stage = (typeof STAGES)[number];

export const ARTIFACT_STATUS = ['pending', 'generating', 'done', 'failed'] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUS)[number];

export const QUESTIONNAIRE_VERSION = 'v1';

/** 问卷答案（必答 4 项 + 选答 + 类型级联项） */
export interface QuestionnaireAnswers {
  /** 必答 */
  genre: Genre;
  /** 必答 */
  length: StoryLength;
  /** 必答 */
  tone: string;
  /** 必答 */
  pov: string;
  /** 选答（默认"不指定"） */
  pacing?: string;
  ending?: string;
  romance?: string;
  orientation?: string;
  /** 作者的一句话创意（选填） */
  idea?: string;
  taboos?: string[];
  /** 类型特有选答项，由类型配置声明 */
  extras?: Record<string, string>;
}

export const REQUIRED_ANSWER_FIELDS = ['genre', 'length', 'tone', 'pov'] as const;

/**
 * 种子（Premise）产物 schema。
 * 注意：**不含**类型、篇幅、基调、叙事视角——这些由问卷直接决定，不交给模型生成，
 * 以避免模型输出与作者选择冲突。
 */
export const PremiseSchema = z.object({
  title: z.string().describe('暂定书名'),
  logline: z.string().describe('一句话梗概，突出钩子'),
  theme: z.string().describe('故事想表达的主题'),
  coreConflict: z.string().describe('核心矛盾：谁与谁、因何冲突'),
  protagonist: z
    .object({
      name: z.string().describe('主角姓名'),
      identity: z.string().describe('身份'),
      desire: z.string().describe('最想要什么'),
      flaw: z.string().describe('缺陷或软肋'),
    })
    .describe('主角雏形，完整人物设定留给人物阶段'),
  setting: z
    .object({
      era: z.string().describe('时代背景'),
      place: z.string().describe('主要发生地'),
      socialBackground: z.string().describe('社会环境或背景'),
    })
    .describe('背景概要，完整世界观留给世界观阶段'),
  hook: z.string().describe('卖点或爽点'),
  taboos: z.array(z.string()).describe('需要避免的内容'),
});

export type Premise = z.infer<typeof PremiseSchema>;
