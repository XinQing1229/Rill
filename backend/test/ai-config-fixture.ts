import type { AiConfig } from '../src/ai/config/ai.config.js';

export function makeAiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    providers: {
      deepseek: {
        apiKey: 'secret-key-value',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        minTemperature: 0,
        maxTemperature: 2,
      },
      glm: {
        apiKey: '',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
        model: 'glm-5.3',
        minTemperature: Number.MIN_VALUE,
        maxTemperature: 0.999999,
      },
    },
    defaults: { temperature: 0.9, maxTokens: 4096, timeout: 60_000 },
    credentialEncryptionKey: '',
    retry: {
      maxAttempts: 3,
      initialInterval: 10,
      backoffFactor: 1,
      maxInterval: 20,
      jitter: false,
    },
    structured: { maxRepairAttempts: 2 },
    budget: { maxCallsPerRequest: 6 },
    pricing: { inputPerMTokens: null, outputPerMTokens: null },
    ...overrides,
  };
}
