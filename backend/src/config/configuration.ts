function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numOrNull(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

/**
 * 从环境变量读取配置。
 * apiKey 允许为空：服务照常启动，仅 LLM 功能返回明确错误（见 dev-environment spec）。
 */
export default function registerConfiguration() {
  return {
    llm: {
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY ?? '',
      usages: {
        draft: {
          model: process.env.LLM_DRAFT_MODEL ?? 'deepseek-flash',
          temperature: num(process.env.LLM_DRAFT_TEMPERATURE, 0.9),
          maxTokens: num(process.env.LLM_DRAFT_MAX_TOKENS, 2048),
          timeout: num(process.env.LLM_DRAFT_TIMEOUT, 60_000),
          thinking: bool(process.env.LLM_DRAFT_THINKING, false),
        },
        reasoning: {
          model: process.env.LLM_REASONING_MODEL ?? 'deepseek-flash',
          temperature: num(process.env.LLM_REASONING_TEMPERATURE, 0.3),
          maxTokens: num(process.env.LLM_REASONING_MAX_TOKENS, 4096),
          timeout: num(process.env.LLM_REASONING_TIMEOUT, 120_000),
          thinking: bool(process.env.LLM_REASONING_THINKING, true),
        },
      },
      retry: {
        maxAttempts: num(process.env.LLM_RETRY_MAX_ATTEMPTS, 3),
        initialInterval: num(process.env.LLM_RETRY_INITIAL_INTERVAL, 500),
        backoffFactor: num(process.env.LLM_RETRY_BACKOFF_FACTOR, 2),
        maxInterval: num(process.env.LLM_RETRY_MAX_INTERVAL, 10_000),
        jitter: bool(process.env.LLM_RETRY_JITTER, true),
      },
      structured: {
        maxRepairAttempts: num(process.env.LLM_STRUCTURED_MAX_REPAIR_ATTEMPTS, 2),
      },
      budget: {
        maxCallsPerRequest: num(process.env.LLM_BUDGET_MAX_CALLS_PER_REQUEST, 6),
      },
      pricing: {
        // 每百万 token 单价；为空时只记录 token 数，不估算费用
        inputPerMTokens: numOrNull(process.env.LLM_PRICE_INPUT_PER_MTOKENS),
        outputPerMTokens: numOrNull(process.env.LLM_PRICE_OUTPUT_PER_MTOKENS),
      },
    },
  };
}
