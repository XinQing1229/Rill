import { WritingStyleSelectionSchema, type WritingStyleSelection } from '@rill/shared';

export type WritingStyleStage =
  'premise' | 'world' | 'characters' | 'relations' | 'outline' | 'prose' | 'review';

/** 已发布版本的规则保持不变；调整规则时新增版本，不改变旧项目含义。 */
const SHORT_SATISFYING_V1: Record<WritingStyleStage, string> = {
  premise:
    '开篇目标具体可行动，阻力和失败代价清楚。主角通过选择与行动推进冲突，核心期待能在结局兑现；复用故事发动机表达压力升级，不新增文风字段。',
  world:
    '只构建服务当前冲突的少量规则与势力，明确能力边界、代价和可利用的机会，不为爽感无限扩张设定。',
  characters:
    '主角有能改变处境的目标与行动；对手有合理动机、能力和应对方式，不依赖集体降智或突降能力制造胜利。',
  relations:
    '关系张力来自具体利益、目标与选择，并产生实际后果；保留各方行动理由，不强行和解或预设恋爱模式。',
  outline:
    '尽早建立具体冲突与阅读期待，规划压力升级、反击铺垫、高潮结果与最终回报。反击应改变利益、关系或处境，反转必须有因果和铺垫；过渡章承担明确作用，结局兑现主要期待，不强制悬念。',
  prose:
    '白话清楚，以短句、短段为主，保留必要描写与句式变化。尽早进入具体冲突，优先用行动、对话与选择揭示信息，压缩重复争执和心理解释。反击写清过程、对方反应和实际后果，不用“众人震惊”代替场景；避免持续受辱却无进展。不得改写已确认章纲的关键事件或结局，也不得凭空增添决定胜负的证据、合同条款、权限记录或精确数值。',
  review:
    '依据所选文风检查 pacing 的无效铺陈与重复争执、hook 的期待承接、aesthetic 的空泛情绪与套话、character 的行动动机、consistency/continuity 的因果及 foreshadow 的反转铺垫。反击是否改变处境须结合本章功能判断。单纯文风偏差默认 warning，不因“不够爽”阻塞接受；明确逻辑或人物问题沿用现有严重度规则。检查决定胜负的证据与数值是否有给定材料或前文依据。每项问题引用原文，不伪造爽点统计。',
};

export function renderWritingStyle(
  selection: WritingStyleSelection | undefined,
  stage: WritingStyleStage,
): string {
  if (selection === undefined) return '';
  const style = WritingStyleSelectionSchema.parse(selection);
  return [
    `【文风：短篇爽文 ${style.version}】`,
    '遵守作者指定的类型、篇幅、叙事视角、避雷与已确认设定；历史问卷存在阅读体验时继续遵守。文风不重新决定这些维度，不强制第一人称、每章打脸、固定频率反转或结尾悬念。',
    SHORT_SATISFYING_V1[stage],
  ].join('\n');
}
