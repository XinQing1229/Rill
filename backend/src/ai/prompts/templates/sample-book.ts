import { PromptTemplate } from '../prompt.registry.js';

/**
 * 首个内置模板（用于验证结构化输出链路，不含小说领域结构）。
 *
 * 组织原则：稳定前缀在前、可变内容在后——
 * DeepSeek 按前缀做上下文缓存，稳定部分命中缓存可显著降低成本。
 */
export const sampleBookV1: PromptTemplate = {
  name: 'sample-book',
  version: 'v1',
  requiredVariables: ['topic'],
  render(variables: Record<string, string>): string {
    return [
      '你是一位资深的小说策划编辑。',
      '请始终使用简体中文回答，输出内容简洁、具体、可直接使用。',
      '',
      `请围绕下面给出的题材，构思一部小说的核心设定。`,
      `题材：${variables.topic}`,
    ].join('\n');
  },
};
