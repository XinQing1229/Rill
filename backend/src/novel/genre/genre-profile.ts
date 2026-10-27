import {
  Genre,
  GenreSelection,
  parseStoredGenre,
  selectedGenres,
  Stage,
  StoryLength,
} from '@rill/shared';

export interface ExtraQuestion {
  key: string;
  label: string;
  options: string[];
  allowCustom?: boolean;
}

export interface GenreProfile {
  label: string;
  /** 世界观阶段的详略：detailed（必须详细）/ light / minimal（可跳过） */
  worldWeight: 'detailed' | 'light' | 'minimal';
  /** 该类型声明跳过的阶段 */
  skipStages: Stage[];
  /** 建议规模（按篇幅） */
  suggestedChapters: Record<StoryLength, number>;
  /** 建议人物数量（按篇幅，可被问卷选答覆盖） */
  characterCount: Record<StoryLength, number>;
  /** 世界观生成的输出 token 预算（详细档内容多，需要更大预算） */
  worldMaxTokens: number;
  suggestedWordsPerChapter: number;
  /** 注入提示词的类型特征 */
  traits: string[];
  /** 类型特有的选答项（级联） */
  extraQuestions: ExtraQuestion[];
}

const CHAPTERS: Record<StoryLength, number> = { short: 4 };
const CHARACTERS: Record<StoryLength, number> = { short: 4 };

export const GENRE_PROFILES: Record<Genre, GenreProfile> = {
  xuanhuan: {
    label: '玄幻',
    worldWeight: 'detailed',
    skipStages: [],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 6144,
    suggestedWordsPerChapter: 2500,
    traits: ['力量体系分明', '升级节奏清晰', '世界观宏大'],
    extraQuestions: [
      { key: 'goldenFinger', label: '金手指类型', options: ['系统', '重生', '天赋', '无'] },
      { key: 'powerSystem', label: '力量体系', options: ['修炼等级', '血脉', '符文', '其他'] },
    ],
  },
  dushi: {
    label: '都市',
    worldWeight: 'minimal',
    skipStages: ['world'],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 2048,
    suggestedWordsPerChapter: 2200,
    traits: ['贴近现实', '人际冲突驱动', '职业细节真实'],
    extraQuestions: [],
  },
  xuanyi: {
    label: '悬疑',
    worldWeight: 'light',
    skipStages: [],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 2048,
    suggestedWordsPerChapter: 2500,
    traits: ['线索层层递进', '反转要有铺垫', '节奏紧凑'],
    extraQuestions: [
      { key: 'caseScale', label: '案件规模', options: ['单案', '连环案', '大案套小案'] },
      { key: 'puzzleStyle', label: '解谜风格', options: ['硬核推理', '社会派', '惊悚'] },
    ],
  },
  lishi: {
    label: '历史',
    worldWeight: 'detailed',
    skipStages: [],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 6144,
    suggestedWordsPerChapter: 2600,
    traits: ['考据严谨', '时代矛盾鲜明', '人物命运与历史交织'],
    extraQuestions: [
      { key: 'strictness', label: '考据严格度', options: ['严格考据', '大事件真实', '架空'] },
    ],
  },
  kehuan: {
    label: '科幻',
    worldWeight: 'detailed',
    skipStages: [],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 6144,
    suggestedWordsPerChapter: 2500,
    traits: ['设定自洽', '科技与社会互塑', '概念有惊喜'],
    extraQuestions: [
      { key: 'techTheme', label: '科技主题', options: ['AI', '太空', '赛博', '生物'] },
    ],
  },
  yanqing: {
    label: '言情',
    worldWeight: 'minimal',
    skipStages: ['world'],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 2048,
    suggestedWordsPerChapter: 2000,
    traits: ['情感推进清晰', '关系张力足', '细节有温度'],
    extraQuestions: [],
  },
  xianxia: {
    label: '仙侠',
    worldWeight: 'detailed',
    skipStages: [],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 6144,
    suggestedWordsPerChapter: 2500,
    traits: ['修炼体系自洽', '宗门与修士关系鲜明', '问道与人物抉择交织'],
    extraQuestions: [],
  },
  chaogu: {
    label: '炒股',
    worldWeight: 'minimal',
    skipStages: ['world'],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 2048,
    suggestedWordsPerChapter: 2200,
    traits: ['交易规则与市场背景自洽', '资金变化与风险有依据', '人物博弈推动情节'],
    extraQuestions: [],
  },
  chuanyue: {
    label: '穿越',
    worldWeight: 'detailed',
    skipStages: [],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 6144,
    suggestedWordsPerChapter: 2500,
    traits: ['穿越规则自洽', '原有认知与新环境形成冲突', '身份变化影响人物命运'],
    extraQuestions: [],
  },
  cthulhu: {
    label: '克苏鲁神话',
    worldWeight: 'detailed',
    skipStages: [],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 6144,
    suggestedWordsPerChapter: 2500,
    traits: [
      '未知与宇宙尺度带来恐惧',
      '禁忌知识伴随认知与理智代价',
      '线索逐步揭示真相并保留不可知性',
    ],
    extraQuestions: [],
  },
  other: {
    label: '其他',
    worldWeight: 'light',
    skipStages: [],
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: 2048,
    suggestedWordsPerChapter: 2200,
    traits: ['类型特征由作者补充说明'],
    extraQuestions: [],
  },
};

const ALL_STAGES: Stage[] = ['premise', 'world', 'characters', 'relations', 'outline', 'prose'];

/** 阶段列表 = 完整流程 − 该类型声明跳过的阶段 */
export function stagesFor(genre: GenreSelection | string): Stage[] {
  const skipped = profileFor(genre).skipStages;
  return ALL_STAGES.filter((stage) => !skipped.includes(stage));
}

/** 所选类型平等合并：阶段取并集，特征与问卷去重，预算取最大值。 */
export function profileFor(genre: GenreSelection | string): GenreProfile {
  const genres = selectedGenres(typeof genre === 'string' ? parseStoredGenre(genre) : genre);
  const profiles = genres.map((item) => GENRE_PROFILES[item]);
  if (profiles.length === 1) return profiles[0];
  const weights = ['minimal', 'light', 'detailed'] as const;
  return {
    label: profiles.map((profile) => profile.label).join('、'),
    worldWeight:
      weights[Math.max(...profiles.map((profile) => weights.indexOf(profile.worldWeight)))],
    skipStages: ALL_STAGES.filter((stage) =>
      profiles.every((profile) => profile.skipStages.includes(stage)),
    ),
    suggestedChapters: CHAPTERS,
    characterCount: CHARACTERS,
    worldMaxTokens: Math.max(...profiles.map((profile) => profile.worldMaxTokens)),
    suggestedWordsPerChapter: Math.max(
      ...profiles.map((profile) => profile.suggestedWordsPerChapter),
    ),
    traits: [...new Set(profiles.flatMap((profile) => profile.traits))],
    extraQuestions: [
      ...new Map(
        profiles
          .flatMap((profile) => profile.extraQuestions)
          .map((question) => [question.key, question]),
      ).values(),
    ],
  };
}
