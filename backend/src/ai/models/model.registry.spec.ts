import { ChatDeepSeek } from '@langchain/deepseek';
import { ChatOpenAI } from '@langchain/openai';
import { makeAiConfig } from '../../../test/ai-config-fixture.js';
import { ModelRegistry } from './model.registry.js';

describe('ModelRegistry', () => {
  it('默认解析 DeepSeek 当前模型和通用参数', () => {
    const config = makeAiConfig();
    const registry = new ModelRegistry(config);
    const resolved = registry.resolve();
    expect(resolved.model).toBeInstanceOf(ChatDeepSeek);
    expect(resolved.provider).toBe('deepseek');
    expect(resolved.modelName).toBe('deepseek-flash');
    expect(resolved.temperature).toBe(0.9);
    expect(resolved.maxTokens).toBe(4096);
  });

  it('按用户选择解析 GLM 并限制服务商不支持的 temperature', () => {
    const config = makeAiConfig({
      defaults: { temperature: 1.5, maxTokens: 4096, timeout: 30000 },
    });
    const settings = {
      active: () => ({
        provider: 'glm' as const,
        apiKey: 'glm-user-key',
        baseUrl: config.providers.glm.baseUrl,
        model: config.providers.glm.model,
        temperature: config.defaults.temperature,
        maxTokens: config.defaults.maxTokens,
        timeout: config.defaults.timeout,
      }),
    };
    const registry = new ModelRegistry(config, settings as never);
    const resolved = registry.resolve();
    expect(resolved.model).toBeInstanceOf(ChatOpenAI);
    expect(resolved.provider).toBe('glm');
    expect(resolved.modelName).toBe('glm-5.3');
    expect(resolved.temperature).toBeLessThan(1);
  });

  it('调用级输出上限覆盖默认值', () => {
    const registry = new ModelRegistry(makeAiConfig());
    expect(registry.resolve().maxTokens).toBe(4096);
    expect(registry.resolve({ maxTokens: 8192 }).maxTokens).toBe(8192);
  });

  it('缺少环境密钥时仍可创建客户端，由设置服务在真实调用前返回配置错误', () => {
    const config = makeAiConfig({
      providers: {
        ...makeAiConfig().providers,
        deepseek: { ...makeAiConfig().providers.deepseek, apiKey: '' },
      },
    });
    const registry = new ModelRegistry(config);
    expect(() => registry.resolve()).not.toThrow();
  });
});
