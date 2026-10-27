import { AiConfig, parseAiConfig } from './ai.config.js';
import { makeAiConfig } from '../../../test/ai-config-fixture.js';

const validConfig: AiConfig = makeAiConfig({
  providers: {
    ...makeAiConfig().providers,
    deepseek: { ...makeAiConfig().providers.deepseek, apiKey: 'secret-key-value' },
  },
});

describe('parseAiConfig', () => {
  it('配置合法时原样返回', () => {
    expect(parseAiConfig(validConfig)).toEqual(validConfig);
  });

  it('缺少 GLM 配置时报错并指出字段', () => {
    const broken = { ...validConfig, providers: { deepseek: validConfig.providers.deepseek } };
    expect(() => parseAiConfig(broken)).toThrow(/providers\.glm|配置校验失败/);
  });

  it('provider baseUrl 非法时报错', () => {
    expect(() =>
      parseAiConfig({
        ...validConfig,
        providers: {
          ...validConfig.providers,
          deepseek: { ...validConfig.providers.deepseek, baseUrl: 'not-a-url' },
        },
      }),
    ).toThrow(/providers\.deepseek\.baseUrl/);
  });

  it('重试参数非法时报错', () => {
    const broken = { ...validConfig, retry: { ...validConfig.retry, maxAttempts: 0 } };
    expect(() => parseAiConfig(broken)).toThrow(/配置校验失败/);
  });

  it('报错信息中不回显密钥', () => {
    let message = '';
    try {
      parseAiConfig({
        ...validConfig,
        providers: {
          ...validConfig.providers,
          deepseek: { ...validConfig.providers.deepseek, baseUrl: 'not-a-url' },
        },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).not.toContain('secret-key-value');
  });
});
