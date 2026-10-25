// ESM 下 jest 不注入全局对象，改用 import.meta.jest（@types/jest 已声明其类型）
const jest = import.meta.jest;

import { BadGatewayException, Logger } from '@nestjs/common';
import { SampleBookSchema, ProseSummaryGenerationSchema } from '@rill/shared';
import { AiConfig } from './config/ai.config.js';
import { ModelRegistry } from './models/model.registry.js';
import { PromptRegistry } from './prompts/prompt.registry.js';
import { UsageRecorder } from './observability/usage-recorder.js';
import { LlmService } from './llm.service.js';

const API_KEY = 'secret-key-value';

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    baseUrl: 'https://api.deepseek.com',
    apiKey: API_KEY,
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
    ...overrides,
  };
}

function fakeModel() {
  const structuredInvoke = jest.fn();
  const invoke = jest.fn();
  const model = {
    invoke,
    withStructuredOutput: jest.fn(() => ({ invoke: structuredInvoke })),
  };
  return { model, invoke, structuredInvoke };
}

function setup(overrides: Partial<AiConfig> = {}) {
  const config = makeConfig(overrides);
  const { model, invoke, structuredInvoke } = fakeModel();
  const registry = {
    resolve: jest.fn(() => ({
      model,
      modelName: 'deepseek-flash',
      thinking: false,
      temperature: 0.9,
      maxTokens: 2048,
      timeoutMs: 60_000,
    })),
  } as unknown as ModelRegistry;
  const usage = new UsageRecorder(config);
  const service = new LlmService(config, registry, new PromptRegistry(), usage);
  return { service, registry, invoke, structuredInvoke, usage, config };
}

describe('LlmService.complete', () => {
  it('默认使用 draft 用途并返回内容与 traceId', async () => {
    const { service, registry, invoke } = setup();
    invoke.mockResolvedValue({
      content: '收到',
      usage_metadata: { input_tokens: 3, output_tokens: 2 },
    });

    const result = await service.complete([{ role: 'user', content: 'hi' }]);

    expect(registry.resolve).toHaveBeenCalledWith('draft', {});
    expect(result.content).toBe('收到');
    expect(result.usageKind).toBe('draft');
    expect(result.traceId).toBeDefined();
    expect(result.usage?.totalTokens).toBe(5);
  });

  it('可指定 reasoning 用途', async () => {
    const { service, registry, invoke } = setup();
    invoke.mockResolvedValue({ content: 'ok' });

    await service.complete([{ role: 'user', content: 'hi' }], { usage: 'reasoning' });

    expect(registry.resolve).toHaveBeenCalledWith('reasoning', {});
  });

  it('限流错误退避重试后成功', async () => {
    const { service, invoke } = setup();
    invoke
      .mockRejectedValueOnce(Object.assign(new Error('限流'), { status: 429 }))
      .mockResolvedValueOnce({ content: 'ok' });

    const result = await service.complete([{ role: 'user', content: 'hi' }]);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('ok');
  });

  it('请求类错误不重试', async () => {
    const { service, invoke } = setup();
    invoke.mockRejectedValue(Object.assign(new Error('未授权'), { status: 401 }));

    await expect(service.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow('未授权');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('超时计入失败并按服务端错误重试，最终抛出', async () => {
    const { service, invoke } = setup();
    invoke.mockRejectedValue(new Error('Request timed out.'));

    await expect(service.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/timed out/);
    // 超时属于服务端错误，会被重试；达到 maxAttempts 后失败
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it('总调用预算耗尽后停止重试', async () => {
    const { service, invoke } = setup({ budget: { maxCallsPerRequest: 2 } });
    invoke.mockRejectedValue(Object.assign(new Error('限流'), { status: 429 }));

    await expect(service.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/预算上限/);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe('LlmService.completeStructured', () => {
  it('摘要长度或数量超限时回喂校验错误，修复后返回完整结果', async () => {
    const { service, structuredInvoke } = setup();
    const valid = {
      events: ['林舟被安排次日加试'],
      characterChanges: [],
      foreshadowing: [],
      continuity: '承接次日加试。',
    };
    structuredInvoke
      .mockResolvedValueOnce({ ...valid, events: ['字'.repeat(121)] })
      .mockResolvedValueOnce({ ...valid, events: Array(7).fill('事件') })
      .mockResolvedValueOnce(valid);
    await expect(
      service.completeStructured(ProseSummaryGenerationSchema, [{ role: 'user', content: '正文' }]),
    ).resolves.toEqual(valid);
    expect(structuredInvoke).toHaveBeenCalledTimes(3);
    const messages = structuredInvoke.mock.calls[2][0] as Array<{ content: string }>;
    expect(messages[1].content).toContain('120');
    expect(messages[2].content).toContain('6');
  });
  it('完整正文修订拒绝供应商标记为截断的结构化结果', async () => {
    const { service, structuredInvoke } = setup({ structured: { maxRepairAttempts: 0 } });
    structuredInvoke.mockImplementation(async (_messages, options) => {
      for (const callback of options.callbacks ?? [])
        callback.handleLLMEnd?.({
          generations: [[{ message: { response_metadata: { finish_reason: 'length' } } }]],
        });
      return { title: 't', summary: 's', tags: ['a'] };
    });
    await expect(
      service.completeStructured(SampleBookSchema, [{ role: 'user', content: '正文' }], {
        rejectTruncated: true,
      }),
    ).rejects.toThrow('截断');
  });
  it('结构化生成强制关闭思维链', async () => {
    const { service, registry, structuredInvoke } = setup();
    structuredInvoke.mockResolvedValue({ title: 't', summary: 's', tags: ['a'] });

    await service.completeStructured(SampleBookSchema, [{ role: 'user', content: 'x' }], {
      usage: 'reasoning',
    });

    expect(registry.resolve).toHaveBeenCalledWith('reasoning', { thinking: false });
  });

  it('maxTokens 透传到模型构造参数（invoke 选项会被 SDK 忽略）', async () => {
    const { service, registry, structuredInvoke } = setup();
    structuredInvoke.mockResolvedValue({ title: 't', summary: 's', tags: ['a'] });

    await service.completeStructured(SampleBookSchema, [{ role: 'user', content: 'x' }], {
      maxTokens: 8192,
    });

    expect(registry.resolve).toHaveBeenCalledWith('draft', {
      thinking: false,
      maxTokens: 8192,
    });
  });

  it('校验失败时回喂错误重试，第二次成功', async () => {
    const { service, structuredInvoke } = setup();
    const parseError = Object.assign(new Error('输出不是合法 JSON'), {
      name: 'OutputParserException',
    });
    structuredInvoke
      .mockRejectedValueOnce(parseError)
      .mockResolvedValueOnce({ title: '临安十二时', summary: '简介', tags: ['南宋'] });

    const result = await service.completeStructured<{ title: string }>(SampleBookSchema, [
      { role: 'user', content: 'x' },
    ]);

    expect(structuredInvoke).toHaveBeenCalledTimes(2);
    expect(result.title).toBe('临安十二时');

    // 第二次调用应带上上一次的校验错误信息
    const secondCallMessages = structuredInvoke.mock.calls[1][0] as Array<{ content: string }>;
    expect(secondCallMessages.some((message) => message.content.includes('结构校验'))).toBe(true);
  });

  it('重试耗尽后抛出不含密钥的错误', async () => {
    const { service, structuredInvoke } = setup({ structured: { maxRepairAttempts: 1 } });
    structuredInvoke.mockRejectedValue(
      Object.assign(new Error('始终不合规'), { name: 'OutputParserException' }),
    );

    await expect(
      service.completeStructured(SampleBookSchema, [{ role: 'user', content: 'x' }]),
    ).rejects.toThrow(BadGatewayException);
    expect(structuredInvoke).toHaveBeenCalledTimes(2); // 首次 + 1 次修复重试
  });
});

describe('LlmService 可观测', () => {
  it('日志中包含 traceId 与用量，且不含 API 密钥', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service, invoke } = setup();

    // 模拟真实模型行为：调用结束后触发传入的 callback
    invoke.mockImplementation(
      async (
        _messages: unknown,
        options?: { callbacks?: Array<{ handleLLMEnd?: (output: unknown) => void }> },
      ) => {
        options?.callbacks?.[0]?.handleLLMEnd?.({
          llmOutput: { tokenUsage: { promptTokens: 5, completionTokens: 3 } },
        });
        return { content: 'ok', usage_metadata: { input_tokens: 5, output_tokens: 3 } };
      },
    );

    const result = await service.complete([{ role: 'user', content: 'hi' }], {
      traceId: 'trace-log-check',
    });

    const logged = logSpy.mock.calls.map((call) => String(call[0])).join(' ');
    expect(logged).toContain('traceId=trace-log-check');
    expect(logged).toContain('tokens=5in/3out');
    expect(logged).not.toContain(API_KEY);
    expect(result.traceId).toBe('trace-log-check');
    logSpy.mockRestore();
  });

  it('stream 为预留方法，迭代时报错', async () => {
    const { service } = setup();
    await expect(service.stream().next()).rejects.toThrow('尚未实现');
  });
});
