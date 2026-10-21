export interface LlmConfiguration {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 从环境变量读取 LLM 提供商配置。
 * apiKey 允许为空：服务照常启动，仅 LLM 功能返回明确错误（见 dev-environment spec）。
 */
export default function registerConfiguration(): { llm: LlmConfiguration } {
  const llm: LlmConfiguration = {
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
  };
  return { llm };
}
