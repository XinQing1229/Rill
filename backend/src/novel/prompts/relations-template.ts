import { PromptTemplate } from '../../ai/prompts/prompt.registry.js';

/**
 * 关系阶段模板。稳定前缀在前，上游产物作为变量注入。
 */
export const relationsV1: PromptTemplate = {
  name: 'relations',
  version: 'v1',
  requiredVariables: ['upstream'],
  render(variables: Record<string, string>): string {
    return [
      '你是一位资深的人物关系设计师，为已定稿的人物编织关系网。',
      '请始终使用简体中文；关系要有张力与戏剧潜力，避免全都和睦无害。',
      '重要约束：',
      '- 只能使用上方列出的人物姓名，不要引入新人物；',
      '- 同一对人物之间只描述一次关系，即使他们之间有多重关联，也合并为一条并写清主关系；',
      '- 关系可能不对称（如师徒），请如实填写双方的相对角色。',
      '- 在 description 中说明双方当前的张力或利益位置，以及一个可能改变关系的关键选择或事件和它带来的后果；关系变化必须来自人物行动，不要只写抽象情绪。',
      '- 关系可以复杂或矛盾，不必强行和解；每一方都应保有自己的目标与立场。',
      '',
      variables.upstream,
      '',
      '请输出关系列表。',
    ].join('\n');
  },
};
