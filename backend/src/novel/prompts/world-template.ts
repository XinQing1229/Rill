import { PromptTemplate } from '../../ai/prompts/prompt.registry.js';

/**
 * 世界观阶段模板。稳定前缀在前，上游产物与档位要求作为变量注入。
 */
export const worldV2: PromptTemplate = {
  name: 'world',
  version: 'v2',
  requiredVariables: ['upstream', 'genre', 'genreTraits', 'tier', 'tone'],
  render(variables: Record<string, string>): string {
    const tierInstruction =
      variables.tier === 'light'
        ? '只需产出「规则」与「势力」，不要产出地理、历史与秘密。'
        : '请完整产出规则、势力、地理、历史与秘密（秘密可作为后续伏笔素材）。';

    // 内容上限：控制输出体量，避免超出 token 预算导致 JSON 截断，同时让设定更紧凑可用
    const budgetInstruction =
      '体量上限（必须遵守）：规则最多 4 条，势力最多 3 个，地理/历史/秘密各最多 2 条；' +
      '每条描述不超过 60 字，力量体系等自定义块同样保持精炼。宁缺毋滥。';

    return [
      variables.writingStyle ?? '',
      '你是一位资深的世界观设计师，为小说搭建自洽且有戏剧张力的世界。',
      '请始终使用简体中文，内容具体、可落地，避免空泛的口号式描述。',
      '重要：时代与地点已由种子确定，你不要输出它们，也不要与之矛盾。',
      '每条规则、每个势力和类型自定义设定都必须能进入剧情：说明它给人物带来的限制、代价、压力或可利用的机会，并与种子中的主角目标或核心冲突相连。规则要能迫使人物选择，势力要有会影响主角行动的目的；不要只罗列背景知识。',
      '保留已有数量和字数上限；优先写少量能改变人物行动的设定。',
      '',
      variables.upstream,
      '',
      `类型：${variables.genre}`,
      `类型特征：${variables.genreTraits}`,
      `阅读体验：${variables.tone}`,
      '',
      `产出要求：${tierInstruction}`,
      budgetInstruction,
      '',
      '请输出这个世界的设定。',
    ].join('\n');
  },
};

export const worldV3: PromptTemplate = {
  ...worldV2,
  version: 'v3',
  requiredVariables: worldV2.requiredVariables.filter((key) => key !== 'tone'),
  render: (v) =>
    [
      worldV2
        .render({ ...v, tone: v.tone ?? '' })
        .replace(`阅读体验：${v.tone ?? ''}\n`, v.tone ? `作者历史阅读体验：${v.tone}\n` : ''),
      v.profession ? `作者历史职业约束：${JSON.stringify(v.profession)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
};
