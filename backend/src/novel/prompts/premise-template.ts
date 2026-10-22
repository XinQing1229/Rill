import { PromptTemplate } from '../../ai/prompts/prompt.registry.js';

/**
 * 种子阶段提示词模板。
 * 组织原则：稳定前缀在前、可变内容在后（命中上下文缓存降本）。
 * 类型特征与问卷答案作为变量注入，不按「阶段 × 类型」建模板。
 */
export const premiseV1: PromptTemplate = {
  name: 'premise',
  version: 'v1',
  requiredVariables: ['genre', 'genreTraits', 'tone', 'pov', 'length'],
  render(variables: Record<string, string>): string {
    const idea = variables.idea?.trim();
    const taboos = variables.taboos?.trim();

    return [
      '你是一位资深的小说策划编辑，擅长把一个创意打磨成可落地的作品种子。',
      '请始终使用简体中文，输出内容具体、可直接用于后续创作。',
      '重要：类型、篇幅、基调、叙事视角已由作者指定，你的输出必须与这些设定一致，且不要在输出中重复声明它们。',
      '故事发动机必须具体可行动：区分主角长期欲望与开篇目标，写明主要阻力、失败的具体代价，并给出 2 至 4 步逐渐加重的压力路径。每一步都应由前一步引发或使目标更难达成，避免只写抽象情绪。',
      '开篇目标应能在故事开始时采取行动；阻力可以来自人物、势力、规则或处境；升级路径要让冲突逐步扩大或代价升高。',
      '',
      `类型：${variables.genre}`,
      `类型特征：${variables.genreTraits}`,
      `篇幅：${variables.length}`,
      `基调：${variables.tone}`,
      `叙事视角：${variables.pov}`,
      idea
        ? `作者的一句话创意：${idea}`
        : '作者未提供具体创意，请你自行构思一个最适合该类型与基调的创意。',
      taboos ? `需要避免的内容：${taboos}` : '',
      '',
      '请输出这部作品的种子设定。',
    ]
      .filter(Boolean)
      .join('\n');
  },
};
