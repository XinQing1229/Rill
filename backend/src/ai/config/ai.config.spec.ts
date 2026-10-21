import { AiConfig, parseAiConfig } from './ai.config';

const validConfig: AiConfig = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'secret-key-value',
  usages: {
    draft: {
      model: 'deepseek-flash',
      temperature: 0.9,
      maxTokens: 2048,
      timeout: 60_000,
      thinking: false,
    },
    reasoning: {
      model: 'deepseek-flash',
      temperature: 0.3,
      maxTokens: 4096,
      timeout: 120_000,
      thinking: true,
    },
  },
  retry: {
    maxAttempts: 3,
    initialInterval: 500,
    backoffFactor: 2,
    maxInterval: 10_000,
    jitter: true,
  },
  structured: { maxRepairAttempts: 2 },
  budget: { maxCallsPerRequest: 6 },
  pricing: { inputPerMTokens: null, outputPerMTokens: null },
};

describe('parseAiConfig', () => {
  it('配置合法时原样返回', () => {
    expect(parseAiConfig(validConfig)).toEqual(validConfig);
  });

  it('缺少用途配置时报错并指出字段', () => {
    const broken = { ...validConfig, usages: { draft: validConfig.usages.draft } };
    expect(() => parseAiConfig(broken)).toThrow(/usages\.reasoning|配置校验失败/);
  });

  it('baseUrl 非法时报错', () => {
    expect(() => parseAiConfig({ ...validConfig, baseUrl: 'not-a-url' })).toThrow(/baseUrl/);
  });

  it('重试参数非法时报错', () => {
    const broken = { ...validConfig, retry: { ...validConfig.retry, maxAttempts: 0 } };
    expect(() => parseAiConfig(broken)).toThrow(/配置校验失败/);
  });

  it('报错信息中不回显密钥', () => {
    let message = '';
    try {
      parseAiConfig({ ...validConfig, baseUrl: 'not-a-url' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).not.toContain('secret-key-value');
  });
});
