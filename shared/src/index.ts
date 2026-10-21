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
}
