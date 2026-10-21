import { PromptTemplate } from '../../ai/prompts/prompt.registry';

/**
 * 人物阶段模板。稳定前缀在前，上游产物与人物规模作为变量注入。
 */
export const charactersV1: PromptTemplate = {
  name: 'characters',
  version: 'v1',
  requiredVariables: ['upstream', 'count'],
  render(variables: Record<string, string>): string {
    return [
      '你是一位资深的人物设计师，为小说设计动机清晰、彼此纠缠的人物。',
      '请始终使用简体中文；人物要具体可演，避免完美人设与脸谱化反派。',
      `请输出 ${variables.count} 个人物。`,
      '重要：列表中的第一个人物必须是种子中主角的扩展——身份、欲望、软肋与之保持一致或在其基础上深化，姓名可沿用或细化。',
      '其余人物应各自承载不同的戏剧功能（制造障碍、提供信息、情感支撑等），不要全是陪衬。',
      '',
      variables.upstream,
      '',
      '请输出人物列表。',
    ].join('\n');
  },
};
