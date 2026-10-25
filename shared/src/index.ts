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

export const LENGTHS = ['short'] as const;
export type StoryLength = (typeof LENGTHS)[number];
export const TONES = ['轻松', '热血', '治愈', '暗黑', '紧张', '厚重'] as const;
export const POVS = ['第一人称', '第三人称限知', '第三人称全知'] as const;

export const PIPELINE_MODES = ['manual', 'auto'] as const;
export type PipelineMode = (typeof PIPELINE_MODES)[number];

export const STAGES = ['premise', 'world', 'characters', 'relations', 'outline', 'prose'] as const;
export type Stage = (typeof STAGES)[number];

export const ARTIFACT_STATUS = ['pending', 'generating', 'done', 'failed'] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUS)[number];

export const QUESTIONNAIRE_VERSION = 'v3';

export const WRITING_STYLES = ['short-satisfying'] as const;
export const WRITING_STYLE_LABELS = { 'short-satisfying': '短篇爽文' } as const;
export const WritingStyleSelectionSchema = z
  .object({
    id: z.literal('short-satisfying'),
    version: z.literal('v1'),
  })
  .strict();
export type WritingStyleSelection = z.infer<typeof WritingStyleSelectionSchema>;
export const DEFAULT_WRITING_STYLE: WritingStyleSelection = {
  id: 'short-satisfying',
  version: 'v1',
};

/** 问卷答案（必答 3 项 + 选答 + 类型级联项） */
export interface QuestionnaireAnswers {
  /** 必答 */
  genre: Genre;
  /** 必答 */
  length: StoryLength;
  /** 仅用于读取历史项目的阅读体验 */
  tone?: string;
  /** 必答 */
  pov: string;
  /** 选答（默认"不指定"） */
  writingStyle?: WritingStyleSelection;
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

export const REQUIRED_ANSWER_FIELDS = ['genre', 'length', 'pov'] as const;

/** 问卷答案的结构校验（genre/length 为结构性枚举，必须精确匹配） */
export const QuestionnaireAnswersSchema = z.object({
  genre: z.enum(GENRES),
  length: z.enum(LENGTHS),
  tone: z.string().optional(),
  pov: z.string().min(1, '叙事视角不能为空'),
  writingStyle: WritingStyleSelectionSchema.optional(),
  pacing: z.string().optional(),
  ending: z.string().optional(),
  romance: z.string().optional(),
  orientation: z.string().optional(),
  idea: z.string().optional(),
  taboos: z.array(z.string()).optional(),
  extras: z.record(z.string(), z.string()).optional(),
});

/** 标题来源：旧项目默认视为作者命名，禁止凭展示文本猜测来源。 */
export const ProjectTitleSourceSchema = z.enum(['author', 'placeholder', 'generated']);
export type ProjectTitleSource = z.infer<typeof ProjectTitleSourceSchema>;
export const STORY_IDEA_MAX_LENGTH = 2000;
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => value || undefined);

/** 新建输入与历史读取分开：旧答案不受新输入长度上限影响。 */
export const CreateQuestionnaireAnswersSchema = QuestionnaireAnswersSchema.extend({
  idea: optionalText(STORY_IDEA_MAX_LENGTH, '故事想法最多 2000 字符'),
}).transform(({ tone: _tone, extras, ...answers }) => {
  const normalized = { ...extras };
  delete normalized.profession;
  delete normalized.relation;
  return { ...answers, extras: Object.keys(normalized).length ? normalized : undefined };
});

/** POST /api/novel/projects 请求体 */
export const CreateProjectSchema = z.object({
  title: optionalText(100, '书名最多 100 字符'),
  answers: CreateQuestionnaireAnswersSchema,
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
 * 注意：**不含**类型、篇幅、叙事视角——这些由问卷直接决定，不交给模型生成，
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

/** 种子建议修改：候选只在显式采用后成为正式内容。 */
export const PreviewPremiseBodySchema = z.object({
  requestId: z.uuid(),
  feedback: z.string().trim().min(1, '请填写修改建议').max(2000, '修改建议不能超过 2000 字'),
});
export const AdoptPremiseBodySchema = z.object({ candidateId: z.string().min(1) });
/** 固定比对单元：按故事概要、发动机、主角、背景、避雷排列。 */
export const PREMISE_CHANGE_PATHS = [
  'title',
  'logline',
  'theme',
  'coreConflict',
  'hook',
  'storyEngine.openingGoal',
  'storyEngine.mainObstacle',
  'storyEngine.failureCost',
  'storyEngine.escalationPath',
  'protagonist.name',
  'protagonist.identity',
  'protagonist.desire',
  'protagonist.flaw',
  'setting.era',
  'setting.place',
  'setting.socialBackground',
  'taboos',
] as const;
export const PremiseChangePathSchema = z.enum(PREMISE_CHANGE_PATHS);
export type PremiseChangePath = z.infer<typeof PremiseChangePathSchema>;
export const PremiseChangeNoteSchema = z.object({
  path: PremiseChangePathSchema,
  description: z.string().trim().min(1).max(120),
});
export const RevisedPremiseOutputSchema = z.object({
  premise: PremiseSchema,
  changeNotes: z.array(PremiseChangeNoteSchema).max(17).default([]),
});
export type RevisedPremiseOutput = z.infer<typeof RevisedPremiseOutputSchema>;
const PremiseChangeValueSchema = z.union([z.string(), z.array(z.string()), z.null()]);
export const PremiseChangeSummarySchema = z
  .object({
    version: z.literal(1),
    changes: z
      .array(
        z.object({
          path: PremiseChangePathSchema,
          before: PremiseChangeValueSchema,
          after: PremiseChangeValueSchema,
          description: z.string().trim().min(1).max(120),
          descriptionSource: z.enum(['ai', 'fallback']),
        }),
      )
      .max(17),
  })
  .superRefine((summary, ctx) => {
    const seen = new Set<string>();
    summary.changes.forEach((change, index) => {
      if (seen.has(change.path) || JSON.stringify(change.before) === JSON.stringify(change.after))
        ctx.addIssue({
          code: 'custom',
          path: ['changes', index],
          message: '修改项不能重复或包含未变化内容',
        });
      seen.add(change.path);
      const arrayField = change.path === 'taboos' || change.path === 'storyEngine.escalationPath';
      if (
        change.after === null ||
        (arrayField ? !Array.isArray(change.after) : typeof change.after !== 'string') ||
        (change.before === null
          ? !change.path.startsWith('storyEngine.')
          : arrayField
            ? !Array.isArray(change.before)
            : typeof change.before !== 'string')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['changes', index],
          message: '修改前后值与字段类型不一致',
        });
    });
  });
export type PremiseChangeSummary = z.infer<typeof PremiseChangeSummarySchema>;
export const PremisePreviewSchema = z.object({
  candidateId: z.string().min(1),
  premise: PremiseSchema,
  changeSummary: PremiseChangeSummarySchema.nullable().default(null),
  changeSummaryWarning: z.string().optional(),
});
export type PreviewPremiseBody = z.infer<typeof PreviewPremiseBodySchema>;
export type AdoptPremiseBody = z.infer<typeof AdoptPremiseBodySchema>;
export type PremisePreview = z.infer<typeof PremisePreviewSchema>;

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
};

/** 问卷结构（GET /api/novel/questionnaire 响应） */
export interface QuestionOption {
  value: string;
  label: string;
}

export const QuestionSchema = z.object({
  /** 问卷键：必答项直接取值（如 length），选答带 `extras.` 前缀 */
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  options: z.array(z.object({ value: z.string(), label: z.string() })),
  /** 是否允许作者填写预设选项之外的内容 */
  allowCustom: z.boolean().optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

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
  /** 历史客户端可忽略的书名来源 */
  titleSource?: ProjectTitleSource;
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

// ---------------- 正文：文件权威、AI 审核与人工接受 ----------------
export const PROSE_REVIEW_DIMENSIONS = [
  'consistency',
  'character',
  'pacing',
  'continuity',
  'foreshadow',
  'hook',
  'aesthetic',
] as const;
export const ProseReviewDimensionSchema = z.enum(PROSE_REVIEW_DIMENSIONS);
export const ProseVerdictSchema = z.enum(['accept', 'polish', 'rewrite']);
export const ProseSeveritySchema = z.enum(['warning', 'error', 'critical']);
export const ProseHashSchema = z.string().regex(/^[a-f0-9]{64}$/, '需要 SHA-256 内容哈希');
const ProseTextSchema = z.string().trim().min(1);
const ProseRevisionSchema = z.number().int().nonnegative();
export const ProseChapterNumberSchema = z.number().int().positive().safe();
export const ProseChapterParamSchema = z
  .string()
  .regex(/^\d+$/, '章号必须为正整数')
  .transform(Number)
  .pipe(ProseChapterNumberSchema);

/** 跨章证据同时保留来源章号和摘要中的原文，供服务端核验。 */
const ProseQuoteSchema = z.string().refine((text) => text.trim().length > 0, '引用不能为空白');
export const ProseIssueSchema = z.object({
  dimension: ProseReviewDimensionSchema,
  severity: ProseSeveritySchema,
  problem: ProseTextSchema,
  evidence: z.array(ProseQuoteSchema).min(1),
  location: ProseTextSchema,
  basis: ProseTextSchema,
  suggestion: ProseTextSchema,
  previousEvidence: z
    .object({
      chapterNumber: ProseChapterNumberSchema,
      quotes: z.array(ProseQuoteSchema).min(1),
    })
    .optional(),
});
export const ProseScoresSchema = z.object({
  consistency: z.number().int().min(0).max(100),
  character: z.number().int().min(0).max(100),
  pacing: z.number().int().min(0).max(100),
  continuity: z.number().int().min(0).max(100),
  foreshadow: z.number().int().min(0).max(100),
  hook: z.number().int().min(0).max(100),
  aesthetic: z.number().int().min(0).max(100),
});
export type ProseIssue = z.infer<typeof ProseIssueSchema>;
export type ProseVerdict = z.infer<typeof ProseVerdictSchema>;

/** verdict 由严重度决定，评分不作为通过门槛。 */
export function proseVerdictFor(issues: readonly ProseIssue[]): ProseVerdict {
  if (issues.some((issue) => issue.severity === 'critical')) return 'rewrite';
  if (issues.some((issue) => issue.severity === 'error')) return 'polish';
  return 'accept';
}

/** 模型输出只描述观察结果，服务端据此派生 verdict。 */
export const ProseReviewOutputSchema = z.object({
  scores: ProseScoresSchema,
  issues: z.array(ProseIssueSchema),
});
/** 失败诊断只用于排查，不能作为有效审核报告消费。 */
export const ProseFailedReviewSchema = z.object({
  formatVersion: z.literal(1),
  status: z.literal('failed'),
  reviewId: ProseTextSchema,
  chapterNumber: ProseChapterNumberSchema,
  sourceHash: ProseHashSchema,
  dependencyFingerprint: ProseHashSchema,
  promptVersion: ProseTextSchema,
  failedAt: z.string().datetime(),
  error: ProseTextSchema,
  output: z.json(),
});
export type ProseFailedReview = z.infer<typeof ProseFailedReviewSchema>;
export const ProseReviewReportSchema = ProseReviewOutputSchema.extend({
  id: ProseTextSchema,
  sourceHash: ProseHashSchema,
  dependencyFingerprint: ProseHashSchema,
  promptVersion: ProseTextSchema,
  coveredChapters: z.array(ProseChapterNumberSchema),
  verdict: ProseVerdictSchema,
  overrideReason: ProseTextSchema.nullable(),
}).refine((report) => report.verdict === proseVerdictFor(report.issues), {
  message: '审核结论与问题严重度不一致',
  path: ['verdict'],
});
export const ProseSummaryOutputSchema = z.object({
  events: z.array(ProseTextSchema).min(1),
  characterChanges: z.array(ProseTextSchema),
  foreshadowing: z.array(ProseTextSchema),
  continuity: ProseTextSchema,
});
/** 仅约束新摘要生成；历史摘要及 API 读取继续使用 ProseSummaryOutputSchema。 */
export const PROSE_SUMMARY_GENERATION_LIMITS = {
  events: { maxItems: 6, maxCharacters: 120 },
  characterChanges: { maxItems: 5, maxCharacters: 100 },
  foreshadowing: { maxItems: 5, maxCharacters: 100 },
} as const;
export const ProseSummaryGenerationSchema = ProseSummaryOutputSchema.extend({
  events: z
    .array(ProseTextSchema.max(PROSE_SUMMARY_GENERATION_LIMITS.events.maxCharacters))
    .min(1)
    .max(PROSE_SUMMARY_GENERATION_LIMITS.events.maxItems)
    .describe('通常3～5条关键事件，每条40～80字；合并同一因果链，保留结果与后续约束'),
  characterChanges: z
    .array(ProseTextSchema.max(PROSE_SUMMARY_GENERATION_LIMITS.characterChanges.maxCharacters))
    .max(PROSE_SUMMARY_GENERATION_LIMITS.characterChanges.maxItems)
    .describe('通常0～4条，每条30～60字；每人通常一条，只记持续状态变化，无变化返回空数组'),
  foreshadowing: z
    .array(ProseTextSchema.max(PROSE_SUMMARY_GENERATION_LIMITS.foreshadowing.maxCharacters))
    .max(PROSE_SUMMARY_GENERATION_LIMITS.foreshadowing.maxItems)
    .describe('通常0～4条，每条30～70字；只记新增或推进的未解线索，不推测后续剧情'),
});
export const ProsePendingSummarySchema = z.object({
  id: ProseTextSchema,
  reviewId: ProseTextSchema,
  sourceHash: ProseHashSchema,
  dependencyFingerprint: ProseHashSchema,
  data: ProseSummaryOutputSchema,
  accepted: z.boolean(),
});
export const ProseVersionBodySchema = z.object({
  expectedRevision: ProseRevisionSchema,
  expectedHash: ProseHashSchema,
});
export const CreateProseRevisionBodySchema = ProseVersionBodySchema.extend({
  requestId: z.string().min(1).max(100),
  feedback: z.string().trim().max(2000).default(''),
  reviewSelection: z
    .object({
      reviewId: z.string().min(1),
      issueIndexes: z
        .array(z.number().int().min(0))
        .min(1)
        .max(100)
        .refine((items) => new Set(items).size === items.length, '建议不能重复选择'),
    })
    .optional(),
}).refine((body) => Boolean(body.feedback || body.reviewSelection), '请选择审核建议或填写修改建议');
export const ApplyProseRevisionBodySchema = ProseVersionBodySchema.extend({
  requestId: z.string().min(1).max(100),
});
export const ProseRevisionOutputSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('revised'),
    content: z.string().trim().min(1),
    explanation: z.string(),
    suggestionResponses: z.array(
      z.object({
        issueIndex: z.number().int().nonnegative(),
        explanation: z.string().min(1),
      }),
    ),
  }),
  z.object({ outcome: z.literal('blocked'), explanation: z.string().min(1) }),
]);
export const ProseRevisionDetailSchema = z.object({
  id: z.string(),
  chapterNumber: ProseChapterNumberSchema,
  status: z.enum([
    'generating',
    'ready',
    'applying',
    'applied',
    'blocked',
    'unchanged',
    'failed',
    'discarded',
    'stale',
    'conflict',
    'recovery_required',
  ]),
  baseRevision: ProseRevisionSchema,
  baseHash: ProseHashSchema,
  feedback: z.string(),
  reviewId: z.string().nullable(),
  suggestions: z.array(
    z.object({ issueIndex: z.number().int(), problem: z.string(), suggestion: z.string() }),
  ),
  content: z.string().nullable(),
  explanation: z.string().nullable(),
  suggestionResponses: z.array(z.object({ issueIndex: z.number().int(), explanation: z.string() })),
  changes: z.array(z.object({ before: z.string(), after: z.string() })),
  error: z.string().nullable(),
});
export type CreateProseRevisionBody = z.infer<typeof CreateProseRevisionBodySchema>;
export type ApplyProseRevisionBody = z.infer<typeof ApplyProseRevisionBodySchema>;
export type ProseRevision = z.infer<typeof ProseRevisionDetailSchema>;
export const ConfirmProseBodySchema = ProseVersionBodySchema.extend({
  reviewId: ProseTextSchema,
  summaryId: ProseTextSchema,
});
export const OverrideProseReviewBodySchema = ProseVersionBodySchema.extend({
  reviewId: ProseTextSchema,
  reason: ProseTextSchema,
});
export const ProseCandidateSchema = z.object({
  fileStatus: z.enum(['valid', 'missing', 'unreadable']),
  error: z.string().nullable(),
  operationId: ProseTextSchema,
  path: ProseTextSchema,
  content: z.string(),
  sourceHash: ProseHashSchema,
});
export const ProseChapterDetailSchema = z.object({
  chapterNumber: ProseChapterNumberSchema,
  path: ProseTextSchema,
  content: z.string().nullable(),
  revision: ProseRevisionSchema,
  observedHash: ProseHashSchema.nullable(),
  confirmedHash: ProseHashSchema.nullable(),
  generationStatus: z.enum(['pending', 'generating', 'done', 'failed']),
  reviewStatus: z.enum(['pending', 'confirmed', 'needs_review']),
  fileStatus: z.enum(['missing', 'valid', 'empty', 'invalid_encoding', 'unreadable']),
  machineStep: z.enum(['generate', 'ai_review', 'summary', 'human_accept', 'done']),
  report: ProseReviewReportSchema.nullable(),
  summary: ProsePendingSummarySchema.nullable(),
  candidates: z.array(ProseCandidateSchema),
  activeRevision: ProseRevisionDetailSchema.nullable().optional(),
  previousReadyRevision: ProseRevisionDetailSchema.nullable().optional(),
  canRestore: z.boolean().optional(),
  error: z.string().nullable(),
  stale: z.boolean(),
});
export const ProseDetailSchema = z.object({
  directory: ProseTextSchema,
  revision: ProseRevisionSchema,
  targetChapters: ProseChapterNumberSchema,
  acceptedChapters: z.number().int().nonnegative(),
  completed: z.boolean(),
  blockingReason: z.string().nullable(),
  chapters: z.array(ProseChapterDetailSchema),
});
export type ProseReviewOutput = z.infer<typeof ProseReviewOutputSchema>;
export type ProseReviewReport = z.infer<typeof ProseReviewReportSchema>;
export type ProseSummaryOutput = z.infer<typeof ProseSummaryOutputSchema>;
export type ProseChapterDetail = z.infer<typeof ProseChapterDetailSchema>;
export type ProseDetail = z.infer<typeof ProseDetailSchema>;
export type ConfirmProseBody = z.infer<typeof ConfirmProseBodySchema>;
export type OverrideProseReviewBody = z.infer<typeof OverrideProseReviewBodySchema>;

// ---------------- 书本交付：配置、快照与独立任务 ----------------
export const BookFormatSchema = z.enum(['txt', 'markdown', 'epub']);
export type BookFormat = z.infer<typeof BookFormatSchema>;
export const BookCopyModeSchema = z.enum(['plain-with-title', 'plain-body', 'markdown-source']);
export type BookCopyMode = z.infer<typeof BookCopyModeSchema>;
export const BookFormatsSchema = z
  .array(BookFormatSchema)
  .min(1)
  .refine((v) => new Set(v).size === v.length, '格式不能重复');
export const BookTitleOverrideSchema = z.object({
  chapterNumber: ProseChapterNumberSchema,
  title: z.string().trim().min(1).max(200),
  outlineRevision: z.number().int().nonnegative(),
});
export const BookMetadataSchema = z.object({
  title: z.string().trim().max(200),
  author: z.string().trim().max(100),
  introduction: z.string().trim().max(10000),
  chapterTitles: z.array(BookTitleOverrideSchema),
});
export const SaveBookSettingsSchema = BookMetadataSchema.extend({
  title: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().nonnegative(),
}).refine(
  (v) => new Set(v.chapterTitles.map((t) => t.chapterNumber)).size === v.chapterTitles.length,
  '章号不能重复',
);
export const BookSettingsSchema = BookMetadataSchema.extend({
  revision: z.number().int().nonnegative(),
  outlineRevision: z.number().int().nonnegative(),
  chapters: z.array(
    z.object({
      chapterNumber: ProseChapterNumberSchema,
      title: z.string(),
      defaultTitle: z.string(),
      needsCheck: z.boolean(),
    }),
  ),
});
export type BookSettings = z.infer<typeof BookSettingsSchema>;
export type BookMetadata = z.infer<typeof BookMetadataSchema>;
export const BookDiagnosticSchema = z.object({
  code: z.string(),
  message: z.string(),
  chapterNumber: ProseChapterNumberSchema.optional(),
  line: z.number().int().positive().optional(),
});
export type BookDiagnostic = z.infer<typeof BookDiagnosticSchema>;
export const BookDocumentSchema = z.object({
  chapterNumber: ProseChapterNumberSchema,
  title: z.string(),
  source: z.string(),
  sourceHash: ProseHashSchema,
  plain: z.string(),
  markdown: z.string(),
  html: z.string(),
});
export type BookDocument = z.infer<typeof BookDocumentSchema>;
export const BookManifestSchema = z.object({
  version: z.literal(1),
  rendererVersion: z.literal('v1'),
  metadata: BookMetadataSchema,
  contentFingerprint: ProseHashSchema,
  evidenceFingerprint: ProseHashSchema,
  chapters: z.array(
    z.object({ chapterNumber: ProseChapterNumberSchema, path: z.string(), hash: ProseHashSchema }),
  ),
});
export type BookManifest = z.infer<typeof BookManifestSchema>;
export const BookPreviewBodySchema = z.object({
  chapterNumber: ProseChapterNumberSchema.optional(),
  previewToken: ProseHashSchema.optional(),
});
export const BookPreviewSchema = z.object({
  metadata: BookMetadataSchema,
  chapters: z.array(
    z.object({ chapterNumber: ProseChapterNumberSchema, title: z.string(), accepted: z.boolean() }),
  ),
  selected: BookDocumentSchema.nullable(),
  diagnostics: z.array(BookDiagnosticSchema),
  previewToken: ProseHashSchema.nullable(),
  contentFingerprint: ProseHashSchema.nullable(),
});
export type BookPreview = z.infer<typeof BookPreviewSchema>;
export const BookCopyBodySchema = z.object({ mode: BookCopyModeSchema });
export const BookCopyResponseSchema = z.object({
  text: z.string(),
  sourceHash: ProseHashSchema,
  checkedAt: z.string(),
});
export const CreateBookJobSchema = z.object({
  requestId: z.string().uuid(),
  previewToken: ProseHashSchema,
  formats: BookFormatsSchema,
});
export const RetryBookJobSchema = z.object({ formats: BookFormatsSchema });
export const BookJobStatusSchema = z.enum([
  'preparing',
  'generating',
  'succeeded',
  'partial_failed',
  'failed',
  'paused',
  'deleting',
  'delete_failed',
]);
export const BookFileSchema = z.object({
  format: BookFormatSchema,
  status: z.enum(['pending', 'generating', 'succeeded', 'failed']),
  size: z.number().nullable(),
  error: z.string().nullable(),
});
export const BookJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  chapterCount: z.number().int().nonnegative(),
  status: BookJobStatusSchema,
  error: z.string().nullable(),
  snapshotId: z.string().nullable(),
  contentFingerprint: z.string().nullable(),
  versionStatus: z.enum(['current', 'historical', 'unverifiable']),
  createdAt: z.string(),
  files: z.array(BookFileSchema),
});
export type BookJob = z.infer<typeof BookJobSchema>;
export const BookJobListSchema = z.object({
  items: z.array(BookJobSchema),
  page: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

/** Web 模型设置查询不包含密钥本身。 */
export const ApiKeySettingsSchema = z.strictObject({
  hasApiKey: z.boolean(),
  baseUrl: z.string(),
  draftModel: z.string(),
  reasoningModel: z.string(),
});
export type ApiKeySettings = z.infer<typeof ApiKeySettingsSchema>;
export const ApiKeyUpdateSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('replace'),
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9._-]+$/, 'API Key 格式不正确'),
  }),
  z.strictObject({ action: z.literal('remove') }),
]);
export type ApiKeyUpdate = z.infer<typeof ApiKeyUpdateSchema>;
