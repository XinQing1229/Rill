import { Genre, Stage, StoryLength } from '@rill/shared';

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
export function stagesFor(genre: Genre): Stage[] {
  const skipped = GENRE_PROFILES[genre].skipStages;
  return ALL_STAGES.filter((stage) => !skipped.includes(stage));
}

export function profileFor(genre: Genre): GenreProfile {
  return GENRE_PROFILES[genre];
}
