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

export const STAGES = [
  'premise',
  'world',
  'characters',
  'relations',
  'outline',
  'beats',
  'prose',
] as const;
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

/** 问卷答案的结构校验（genre/length 为结构性枚举，必须精确匹配） */
export const QuestionnaireAnswersSchema = z.object({
  genre: z.enum(GENRES),
  length: z.enum(LENGTHS),
  tone: z.string().min(1, '基调不能为空'),
  pov: z.string().min(1, '叙事视角不能为空'),
  pacing: z.string().optional(),
  ending: z.string().optional(),
  romance: z.string().optional(),
  orientation: z.string().optional(),
  idea: z.string().optional(),
  taboos: z.array(z.string()).optional(),
  extras: z.record(z.string(), z.string()).optional(),
});

/** POST /api/novel/projects 请求体 */
export const CreateProjectSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(100, '标题过长'),
  answers: QuestionnaireAnswersSchema,
  mode: z.enum(PIPELINE_MODES).optional(),
});

/** POST /api/novel/projects/:id/generate 请求体 */
export const GenerateBodySchema = z.object({
  force: z.boolean().optional(),
  wait: z.boolean().optional(),
});

/** 确认动作：confirm 确认并推进到下一阶段；regenerate 重新生成本阶段 */
export const CONFIRM_ACTIONS = ['confirm', 'regenerate'] as const;
export type ConfirmAction = (typeof CONFIRM_ACTIONS)[number];

/** POST /api/novel/projects/:id/confirm 请求体（可为空，默认确认推进） */
export const ConfirmBodySchema = z
  .object({
    action: z.enum(CONFIRM_ACTIONS).optional(),
    target: z.enum(['outline-plan', 'outline']).optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .default({});

/** POST /api/novel/projects/:id/rollback 请求体 */
export const RollbackBodySchema = z.object({
  stage: z.enum(STAGES),
});

/** POST /api/novel/projects/:id/mode 请求体 */
export const SetModeBodySchema = z.object({
  mode: z.enum(PIPELINE_MODES),
});

/** GET/DELETE /api/novel/projects 的 scope 查询参数：默认 active（创作中），trash 为回收站 */
export const PROJECT_SCOPES = ['active', 'trash'] as const;
export type ProjectScope = (typeof PROJECT_SCOPES)[number];
export const ProjectScopeSchema = z.enum(PROJECT_SCOPES).optional();

/**
 * 种子（Premise）产物 schema。
 * 注意：**不含**类型、篇幅、基调、叙事视角——这些由问卷直接决定，不交给模型生成，
 * 以避免模型输出与作者选择冲突。
 */
export const StoryEngineSchema = z.object({
  openingGoal: z.string().trim().min(1).describe('主角在故事开篇要达成的具体目标，与长期欲望区分'),
  mainObstacle: z
    .string()
    .trim()
    .min(1)
    .describe('当前阻止主角达成目标的主要人物、势力、规则或处境'),
  failureCost: z.string().trim().min(1).describe('主角未能达成目标将付出的具体代价'),
  escalationPath: z
    .array(z.string().trim().min(1))
    .min(2)
    .max(4)
    .describe('按顺序递进的压力步骤，说明追求目标如何变得更困难或代价更高'),
});

export const PremiseSchema = z.object({
  title: z.string().describe('暂定书名'),
  logline: z.string().describe('一句话梗概，突出钩子'),
  theme: z.string().describe('故事想表达的主题'),
  coreConflict: z.string().describe('核心矛盾：谁与谁、因何冲突'),
  storyEngine: StoryEngineSchema.describe('推动故事持续发展的开篇目标、阻力、代价与升级路径'),
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

/** 兼容历史产物；新生成的种子仍使用要求 storyEngine 的 PremiseSchema。 */
export const PremiseReadSchema = PremiseSchema.extend({
  storyEngine: StoryEngineSchema.optional(),
});
export type Premise = z.infer<typeof PremiseReadSchema>;
export type GeneratedPremise = z.infer<typeof PremiseSchema>;

// ---------------- 世界观与人物 ----------------

/** 世界观通用骨架（所有类型共享）；geography/history/secrets 仅「详细」档产出 */
export const GenericWorldSchema = z.object({
  summary: z.string().describe('世界观概述，两三句话'),
  rules: z
    .array(
      z.object({
        name: z.string().describe('规则名称'),
        description: z.string().describe('规则内容与约束'),
      }),
    )
    .describe('世界规则与约束'),
  factions: z
    .array(
      z.object({
        name: z.string().describe('势力名称'),
        nature: z.string().describe('性质：门派/家族/官府/组织/其他'),
        stance: z.string().describe('立场与目的'),
      }),
    )
    .describe('势力'),
  geography: z
    .array(z.object({ name: z.string(), description: z.string() }))
    .optional()
    .describe('地理（仅详细档产出）'),
  history: z
    .array(z.object({ event: z.string(), impact: z.string() }))
    .optional()
    .describe('历史事件（仅详细档产出）'),
  secrets: z
    .array(
      z.object({
        secret: z.string().describe('未公开的秘密'),
        relatedTo: z.string().describe('与哪些人物或势力相关，可作为伏笔素材'),
      }),
    )
    .optional()
    .describe('未公开的秘密（伏笔素材）'),
});

/** 类型自定义块：玄幻 */
export const XuanhuanWorldSchema = z.object({
  powerSystem: z.object({
    realms: z.array(z.string()).describe('境界或等级划分'),
    resources: z.string().describe('核心资源'),
    cost: z.string().describe('修炼代价或限制'),
  }),
});

/** 类型自定义块：科幻 */
export const KehuanWorldSchema = z.object({
  techTree: z.object({
    keyTech: z.array(z.string()).describe('关键技术'),
    socialImpact: z.string().describe('科技对社会结构的影响'),
    limits: z.string().describe('技术边界或禁忌'),
  }),
});

/** 类型自定义块：历史 */
export const LishiWorldSchema = z.object({
  institutions: z.object({
    government: z.string().describe('官制与权力结构'),
    military: z.string().describe('军制'),
    customs: z.string().describe('礼法与社会风俗'),
  }),
});

/** 类型自定义块：悬疑 */
export const XuanyiWorldSchema = z.object({
  mysteryRules: z.object({
    methodBoundary: z.string().describe('作案手法的可行边界'),
    revealRhythm: z.string().describe('线索揭示的节奏与规则'),
  }),
});

/** 类型自定义块：都市 */
export const DushiWorldSchema = z.object({
  industry: z.object({
    field: z.string().describe('核心行业'),
    rules: z.string().describe('行业规则与潜规则'),
  }),
});

/** 类型自定义块：言情 */
export const YanqingWorldSchema = z.object({
  relationSetting: z.object({
    bond: z.string().describe('两人关系的起点设定'),
    obstacle: z.string().describe('关系的主要障碍'),
  }),
});

export const CUSTOM_WORLD_SCHEMAS = {
  xuanhuan: XuanhuanWorldSchema,
  kehuan: KehuanWorldSchema,
  lishi: LishiWorldSchema,
  xuanyi: XuanyiWorldSchema,
  dushi: DushiWorldSchema,
  yanqing: YanqingWorldSchema,
} as const;

export type WorldGenre = keyof typeof CUSTOM_WORLD_SCHEMAS;

/** 按类型合并出完整的世界观 schema（通用骨架 + 自定义块） */
export function worldSchemaFor(genre: string) {
  const custom = CUSTOM_WORLD_SCHEMAS[genre as WorldGenre];
  return z.object({ ...GenericWorldSchema.shape, ...(custom ? custom.shape : {}) });
}

/** 人物卡 */
export const CharacterSchema = z.object({
  name: z.string().describe('姓名'),
  role: z.enum(['protagonist', 'supporting', 'antagonist']).describe('角色定位'),
  identity: z.string().describe('身份'),
  desire: z.string().describe('最想要什么'),
  flaw: z.string().describe('缺陷或软肋'),
  personality: z.string().describe('性格'),
  background: z.string().describe('背景经历'),
  abilities: z.string().describe('能力或手段'),
  arc: z.string().describe('人物弧光：从什么状态变成什么状态'),
});

export const CharacterListSchema = z.object({
  characters: z.array(CharacterSchema).describe('人物列表，第一个必须是主角'),
});

export type Character = z.infer<typeof CharacterSchema>;

/** 人物关系（模型侧用姓名引用人物，入库时转换为 id） */
export const RelationSchema = z.object({
  fromName: z.string().describe('关系一方的姓名'),
  toName: z.string().describe('关系另一方的姓名'),
  type: z.string().describe('关系类型：师徒/仇敌/亲人/利益/爱慕/其他'),
  fromRole: z.string().describe('前者相对后者的角色，如「师父」'),
  toRole: z.string().describe('后者相对前者的角色，如「徒弟」'),
  description: z.string().describe('关系描述'),
});

export const RelationListSchema = z.object({
  relations: z.array(RelationSchema).describe('关系列表，同一对人物只描述一次'),
});

export type Relation = z.infer<typeof RelationSchema>;

/** 上游产物装配后的阶段上下文（只含已确认且未失效的产物） */
export interface StageContext {
  premise?: Premise;
  world?: Record<string, unknown>;
  characters?: Character[];
  characterRefs?: Array<{ id: string; name: string }>;
  relations?: Array<{
    fromId: string;
    toId: string;
    type: string;
    fromRole: string;
    toRole: string;
    description: string;
  }>;
  outline?: { plan: OutlinePlan; chapters: ChapterSummary[] };
}

// ---------------- 项目读取契约（工作台前端消费） ----------------

/** 项目整体状态 */
export const PROJECT_STATUSES = ['idle', 'running', 'done', 'failed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** 阶段中文名（前后端展示共用） */
export const STAGE_LABELS: Record<Stage, string> = {
  premise: '种子',
  world: '世界观',
  characters: '人物',
  relations: '关系',
  outline: '大纲',
  beats: '细纲',
  prose: '正文',
};

/** 类型中文名（展示用） */
export const GENRE_LABELS: Record<Genre, string> = {
  xuanhuan: '玄幻',
  dushi: '都市',
  xuanyi: '悬疑',
  lishi: '历史',
  kehuan: '科幻',
  yanqing: '言情',
  other: '其他',
};

/** 篇幅中文名（展示用） */
export const LENGTH_LABELS: Record<StoryLength, string> = {
  short: '短篇',
  medium: '中篇',
  long: '长篇',
};

/** 问卷结构（GET /api/novel/questionnaire 响应） */
export interface QuestionOption {
  value: string;
  label: string;
}

export interface Question {
  /** 问卷键：必答项直接取值（如 length），选答带 `extras.` 前缀 */
  key: string;
  label: string;
  required: boolean;
  options: QuestionOption[];
}

export interface QuestionnaireDefinition {
  version: string;
  questions: Question[];
}

/** 产物行公共字段；data 为按阶段 schema 校验后的 JSON 字符串 */
export interface ArtifactRowBase {
  id: string;
  projectId: string;
  status: ArtifactStatus;
  stale: boolean;
  promptTokens: number;
  completionTokens: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PremiseArtifact extends ArtifactRowBase {
  data: string;
}

export interface WorldArtifact extends ArtifactRowBase {
  data: string;
}

export interface CharacterRow extends ArtifactRowBase {
  name: string;
  role: string;
  data: string;
}

export interface RelationRow extends ArtifactRowBase {
  fromId: string;
  toId: string;
  type: string;
  fromRole: string;
  toRole: string;
  description: string;
}

/** POST /api/novel/projects/:id/generate 响应（auto 表示触发了自动连续推进） */
export interface GenerateResponse {
  stage: Stage;
  status: ArtifactStatus;
  started: boolean;
  auto?: boolean;
}

/** GET /api/novel/projects/:id 响应：项目详情 + 各阶段产物行 + 完整阶段列表 */
export interface StageExecutionState {
  status: ArtifactStatus;
  stale: boolean;
  error: string | null;
  confirmedAt: string | null;
}

export interface ProjectDetail {
  outlineProgress?: OutlineProgress | null;
  stageStates?: Partial<Record<Stage, StageExecutionState>>;
  id: string;
  title: string;
  genre: Genre;
  length: StoryLength;
  mode: PipelineMode;
  currentStage: Stage;
  status: ProjectStatus;
  /** 该类型的完整阶段列表（含跳过的阶段），由后端 stagesFor 计算 */
  stages: Stage[];
  /** 问卷答案 JSON 字符串，按 QuestionnaireAnswers 解析 */
  answers: string;
  questionnaireVersion: string;
  promptTokens: number;
  completionTokens: number;
  createdAt: string;
  updatedAt: string;
  /** 软删除时刻：非空表示该项目已移入回收站 */
  deletedAt: string | null;
  premise: PremiseArtifact | null;
  world: WorldArtifact | null;
  characters: CharacterRow[];
  relations: RelationRow[];
}

/** GET /api/novel/projects 列表项（按更新时间倒序） */
export interface ProjectSummary {
  id: string;
  title: string;
  genre: Genre;
  length: StoryLength;
  mode: PipelineMode;
  currentStage: Stage;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  /** 软删除时刻：非空表示该项目已移入回收站 */
  deletedAt: string | null;
}

/** GET /api/novel/projects?scope=trash 列表项（按删除时间倒序） */
export type TrashProjectSummary = ProjectSummary & { deletedAt: string };

// ---------------- 大纲：模型内容、编辑请求与读取契约 ----------------
const OutlineTextSchema = z.string().trim().min(1);
export const TargetChaptersSchema = z.number().int().positive().safe();
export const OutlineSegmentSchema = z.object({
  id: OutlineTextSchema,
  title: OutlineTextSchema,
  goal: OutlineTextSchema,
  events: OutlineTextSchema,
  outcome: OutlineTextSchema,
  startChapter: TargetChaptersSchema,
  endChapter: TargetChaptersSchema,
});
export const OutlinePlanSchema = z.object({
  mainline: OutlineTextSchema,
  turningPoints: z.array(OutlineTextSchema).min(1),
  climax: OutlineTextSchema,
  ending: OutlineTextSchema,
  characterArcs: z
    .array(z.object({ characterId: OutlineTextSchema, development: OutlineTextSchema }))
    .min(1),
  relationDevelopments: z.array(
    z.object({
      fromId: OutlineTextSchema,
      toId: OutlineTextSchema,
      development: OutlineTextSchema,
    }),
  ),
  segments: z.array(OutlineSegmentSchema).min(1),
});
export const ChapterSummarySchema = z.object({
  number: TargetChaptersSchema,
  segmentId: OutlineTextSchema,
  title: OutlineTextSchema,
  events: OutlineTextSchema,
  characterIds: z.array(OutlineTextSchema).min(1),
  conflict: OutlineTextSchema,
  outcome: OutlineTextSchema,
  consequence: OutlineTextSchema,
  foreshadowing: z.string().optional(),
  relationChange: z.string().optional(),
});
export const ChapterBatchSchema = z.object({ chapters: z.array(ChapterSummarySchema).min(1) });
export type OutlinePlan = z.infer<typeof OutlinePlanSchema>;
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;
export const OutlineConfigBodySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  targetChapters: TargetChaptersSchema,
});
export const OutlinePlanBodySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  plan: OutlinePlanSchema,
});
export const OutlineChapterBodySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  chapter: ChapterSummarySchema,
});
export type OutlineConfirm = { target: 'outline-plan' | 'outline'; expectedRevision: number };
export const OUTLINE_STEPS = [
  'planning',
  'plan_review',
  'expanding',
  'outline_review',
  'confirmed',
] as const;
export interface OutlineProgress {
  step: (typeof OUTLINE_STEPS)[number];
  revision: number;
  planRevision: number;
  targetChapters: number;
  planConfirmedRevision: number | null;
  confirmedRevision: number | null;
  stale: boolean;
  completedChapters: number;
  completedBatches: number;
  totalBatches: number;
  error: string | null;
}
export interface OutlineDetail extends OutlineProgress {
  plan: OutlinePlan | null;
  chapters: ChapterSummary[];
  batches: Array<{
    startChapter: number;
    endChapter: number;
    status: string;
    error: string | null;
  }>;
  staleChapters: ChapterSummary[];
}
