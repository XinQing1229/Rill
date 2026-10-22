import { AiConfig } from '../config/ai.config.js';
import { ModelRegistry, buildChatModelOptions } from './model.registry.js';

const config: AiConfig = {
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
    initialInterval: 10,
    backoffFactor: 1,
    maxInterval: 20,
    jitter: false,
  },
  structured: { maxRepairAttempts: 2 },
  budget: { maxCallsPerRequest: 6 },
  pricing: { inputPerMTokens: null, outputPerMTokens: null },
};

describe('buildChatModelOptions', () => {
  it('草稿用途显式关闭思维链', () => {
    const options = buildChatModelOptions(config, config.usages.draft);
    expect(options.modelKwargs.thinking).toEqual({ type: 'disabled' });
  });

  it('重推理用途显式开启思维链', () => {
    const options = buildChatModelOptions(config, config.usages.reasoning);
    expect(options.modelKwargs.thinking).toEqual({ type: 'enabled' });
  });

  it('overrides 可强制关闭思维链（结构化生成使用）', () => {
    const options = buildChatModelOptions(config, config.usages.reasoning, { thinking: false });
    expect(options.modelKwargs.thinking).toEqual({ type: 'disabled' });
  });

  it('思维链开关永不为 undefined', () => {
    for (const usage of ['draft', 'reasoning'] as const) {
      const options = buildChatModelOptions(config, config.usages[usage]);
      expect(options.modelKwargs.thinking.type).toBeDefined();
    }
  });

  it('baseURL、密钥与超时来自配置', () => {
    const options = buildChatModelOptions(config, config.usages.draft);
    expect(options.configuration.baseURL).toBe('https://api.deepseek.com');
    expect(options.apiKey).toBe('secret-key-value');
    // 超时由 SDK 中断调用，超时错误归入服务端错误参与重试
    expect(options.timeout).toBe(config.usages.draft.timeout);
  });
});

describe('ModelRegistry', () => {
  it('按用途解析模型并带上参数', () => {
    const registry = new ModelRegistry(config);
    const resolved = registry.resolve('draft');
    expect(resolved.modelName).toBe('deepseek-flash');
    expect(resolved.thinking).toBe(false);
    expect(resolved.temperature).toBe(0.9);
  });

  it('结构化场景强制关闭思维链', () => {
    const registry = new ModelRegistry(config);
    const resolved = registry.resolve('reasoning', { thinking: false });
    expect(resolved.thinking).toBe(false);
  });

  it('未配置密钥时使用占位值，不影响构造', () => {
    const registry = new ModelRegistry({ ...config, apiKey: '' });
    expect(() => registry.resolve('draft')).not.toThrow();
  });
});
