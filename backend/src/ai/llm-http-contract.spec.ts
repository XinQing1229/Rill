const jest = import.meta.jest;

import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { ProseRevisionOutputSchema } from '@rill/shared';
import { executionContext } from '../novel/pipeline/execution-context.js';
import type { AiConfig } from './config/ai.config.js';
import { LlmService } from './llm.service.js';
import { ModelRegistry } from './models/model.registry.js';
import { UsageRecorder } from './observability/usage-recorder.js';
import { PromptRegistry } from './prompts/prompt.registry.js';
import { makeAiConfig } from '../../test/ai-config-fixture.js';

const config: AiConfig = makeAiConfig({
  providers: {
    ...makeAiConfig().providers,
    deepseek: {
      ...makeAiConfig().providers.deepseek,
      apiKey: 'contract-test-placeholder',
      baseUrl: 'https://llm-contract.invalid/v1',
      model: 'deepseek-chat',
    },
  },
  defaults: { temperature: 0.9, maxTokens: 2048, timeout: 1000 },
  retry: {
    maxAttempts: 1,
    initialInterval: 1,
    backoffFactor: 1,
    maxInterval: 1,
    jitter: false,
  },
  structured: { maxRepairAttempts: 0 },
  budget: { maxCallsPerRequest: 1 },
});
const schema = z.object({ title: z.string() });
const messages = [{ role: 'user' as const, content: '生成测试内容' }];

function service(provider: 'deepseek' | 'glm' = 'deepseek', overrides: Partial<AiConfig> = {}) {
  const selectedConfig = { ...config, ...overrides };
  const settings = {
    active: () => ({
      provider,
      ...selectedConfig.providers[provider],
      apiKey: 'contract-test-placeholder',
      ...selectedConfig.defaults,
    }),
  };
  return new LlmService(
    selectedConfig,
    new ModelRegistry(selectedConfig, settings as never),
    new PromptRegistry(),
    new UsageRecorder(selectedConfig),
  );
}

function response(message: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      id: 'contract-response',
      object: 'chat.completion',
      created: 1,
      model: 'deepseek-chat',
      choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** 使用真实注册表和 SDK，只拦截传输边界；不读取密钥、不连接真实服务。 */
describe('LLM 最终 HTTP 请求契约', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe.each(['deepseek', 'glm'] as const)('%s 兼容回归', (provider) => {
    it('结构化输出发送工具参数并采用各自的思考配置', async () => {
      const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse(init!.body as string);
        const tool = body.tools[0].function;
        return response({
          content: null,
          tool_calls: [
            {
              id: 'provider-tool',
              type: 'function',
              function: { name: tool.name, arguments: JSON.stringify({ title: '测试书名' }) },
            },
          ],
        });
      });
      await expect(service(provider).completeStructured(schema, messages)).resolves.toEqual({
        title: '测试书名',
      });
      const [url, init] = fetch.mock.calls[0];
      const body = JSON.parse(init!.body as string);
      expect(String(url)).toBe(
        `${config.providers[provider].baseUrl.replace(/\/$/, '')}/chat/completions`,
      );
      expect(body.model).toBe(config.providers[provider].model);
      expect(body.response_format).toBeUndefined();
      expect(body.max_tokens).toBe(2048);
      expect(body.thinking).toEqual({ type: provider === 'glm' ? 'enabled' : 'disabled' });
      expect(body.reasoning_effort).toBe(provider === 'glm' ? 'low' : undefined);
      expect(body.tool_choice).toEqual({
        type: 'function',
        function: { name: body.tools[0].function.name },
      });
    });

    it.each([401, 503])('HTTP %s 的实际请求次数受统一重试控制', async (status) => {
      const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify({ error: { message: '合成故障', type: 'test_error' } }), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
      );
      await expect(
        service(provider, {
          retry: { ...config.retry, maxAttempts: 3 },
          structured: { maxRepairAttempts: 2 },
          budget: { maxCallsPerRequest: 6 },
        }).completeStructured(schema, messages),
      ).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(status === 401 ? 1 : 3);
    });

    it('普通补全保持文本请求并正确读取响应', async () => {
      const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(response({ content: '收到' }));
      await expect(service(provider).complete(messages)).resolves.toMatchObject({
        content: '收到',
      });
      const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
      expect(body.model).toBe(config.providers[provider].model);
      expect(body.tools).toBeUndefined();
      expect(body.response_format).toBeUndefined();
    });
  });

  it.each([
    {
      outcome: 'revised',
      content: '修改后的正文',
      explanation: '按建议补充细节',
      suggestionResponses: [0, 1, 2, 3].map((issueIndex) => ({
        issueIndex,
        explanation: '已补充对应细节',
      })),
    },
    { outcome: 'blocked', explanation: '建议与已确认大纲冲突' },
  ])('正文修改预览 $outcome 分支使用对象作为工具参数根节点', async (output) => {
    let parameters: {
      type?: string;
      properties: { result: { oneOf: unknown[] } };
      required?: string[];
    };
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      const tool = body.tools[0].function;
      parameters = tool.parameters;
      return response({
        content: null,
        tool_calls: [
          {
            id: 'revision-tool',
            type: 'function',
            function: {
              name: tool.name,
              arguments: JSON.stringify(
                parameters!.type === 'object' ? { result: output } : output,
              ),
            },
          },
        ],
      });
    });

    await expect(
      service().completeStructured(ProseRevisionOutputSchema, messages),
    ).resolves.toEqual(output);
    // 检查真实 SDK 序列化结果，防止仅 mock 业务方法而漏掉请求格式错误。
    expect(parameters!.type).toBe('object');
    expect(parameters!.properties.result.oneOf).toHaveLength(2);
    expect(parameters!.required).toContain('result');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('包装后的正文修订仍拒绝缺少完整正文的 revised 结果', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const tool = JSON.parse(init!.body as string).tools[0].function;
      return response({
        content: null,
        tool_calls: [
          {
            id: 'invalid-revision-tool',
            type: 'function',
            function: {
              name: tool.name,
              arguments: JSON.stringify({
                result: { outcome: 'revised', explanation: '已修改', suggestionResponses: [] },
              }),
            },
          },
        ],
      });
    });
    await expect(service().completeStructured(ProseRevisionOutputSchema, messages)).rejects.toThrow(
      'content',
    );
  });

  it.each([
    { maxTokens: undefined, expected: 2048 },
    { maxTokens: 8192, expected: 8192 },
  ])('输出上限 $maxTokens 最终序列化为 $expected', async ({ maxTokens, expected }) => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ content: '正文' }));

    await expect(service().complete(messages, { maxTokens })).resolves.toMatchObject({
      content: '正文',
      finishReason: 'stop',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(`${config.providers.deepseek.baseUrl}/chat/completions`);
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      model: config.providers.deepseek.model,
      max_tokens: expected,
      messages,
      thinking: { type: 'disabled' },
    });
    expect(body.tools).toBeUndefined();
    expect(body.response_format).toBeUndefined();
  });

  it('结构化输出最终携带工具 schema、强制工具选择、输出上限并关闭思维链', async () => {
    let body: Record<string, unknown>;
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      body = JSON.parse(init!.body as string);
      const tool = (body.tools as Array<{ function: { name: string } }>)[0];
      return response({
        content: null,
        tool_calls: [
          {
            id: 'contract-tool',
            type: 'function',
            function: { name: tool.function.name, arguments: JSON.stringify({ title: '书名' }) },
          },
        ],
      });
    });

    await expect(
      service().completeStructured(schema, messages, { maxTokens: 8192 }),
    ).resolves.toEqual({ title: '书名' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(body!).toMatchObject({
      model: config.providers.deepseek.model,
      max_tokens: 8192,
      thinking: { type: 'disabled' },
      tools: [
        {
          type: 'function',
          function: {
            parameters: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            },
          },
        },
      ],
    });
    const tool = (body!.tools as Array<{ function: { name: string } }>)[0];
    expect(body!.tool_choice).toEqual({ type: 'function', function: { name: tool.function.name } });
  });

  it.each(
    (['deepseek', 'glm'] as const).flatMap((provider) =>
      [
        { structured: false, explicit: false },
        { structured: true, explicit: false },
        { structured: false, explicit: true },
        { structured: true, explicit: true },
      ].map((scenario) => ({ ...scenario, provider })),
    ),
  )(
    '$provider 取消到达 HTTP 传输（结构化=$structured，显式信号=$explicit）',
    async ({ structured, explicit, provider }) => {
      const contextController = new AbortController();
      const explicitController = new AbortController();
      const selectedController = explicit ? explicitController : contextController;
      let transportSignal: AbortSignal;
      let started!: () => void;
      const requestStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
        transportSignal = init!.signal!;
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('测试取消', 'AbortError'));
          if (transportSignal.aborted) abort();
          else transportSignal.addEventListener('abort', abort, { once: true });
          started();
        });
      });
      const llm = service(provider);
      const pending = executionContext.run(
        { projectId: 'contract', runId: 'contract-run', signal: contextController.signal },
        () => {
          const options = explicit ? { signal: explicitController.signal } : {};
          return structured
            ? llm.completeStructured(schema, messages, options)
            : llm.complete(messages, options);
        },
      );
      const rejected = expect(pending).rejects.toThrow();
      try {
        await requestStarted;
        expect(transportSignal!.aborted).toBe(false);
        if (explicit) {
          contextController.abort();
          expect(transportSignal!.aborted).toBe(false);
        }
        selectedController.abort();
        await rejected;
        expect(transportSignal!.aborted).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
        selectedController.abort();
        await rejected;
      }
    },
  );
});
