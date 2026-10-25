const jest = import.meta.jest;

import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { executionContext } from '../novel/pipeline/execution-context.js';
import type { AiConfig } from './config/ai.config.js';
import { LlmService } from './llm.service.js';
import { ModelRegistry } from './models/model.registry.js';
import { UsageRecorder } from './observability/usage-recorder.js';
import { PromptRegistry } from './prompts/prompt.registry.js';

const config: AiConfig = {
  baseUrl: 'https://llm-contract.invalid/v1',
  apiKey: 'contract-test-placeholder',
  usages: {
    draft: {
      model: 'deepseek-chat',
      temperature: 0.9,
      maxTokens: 2048,
      timeout: 1000,
      thinking: false,
    },
    reasoning: {
      model: 'deepseek-reasoner',
      temperature: 0.3,
      maxTokens: 4096,
      timeout: 1000,
      thinking: true,
    },
  },
  retry: {
    maxAttempts: 1,
    initialInterval: 1,
    backoffFactor: 1,
    maxInterval: 1,
    jitter: false,
  },
  structured: { maxRepairAttempts: 0 },
  budget: { maxCallsPerRequest: 1 },
  pricing: { inputPerMTokens: null, outputPerMTokens: null },
};
const schema = z.object({ title: z.string() });
const messages = [{ role: 'user' as const, content: '生成测试内容' }];

function service() {
  return new LlmService(
    config,
    new ModelRegistry(config),
    new PromptRegistry(),
    new UsageRecorder(config),
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

  it.each([
    { usage: 'draft' as const, maxTokens: undefined, expected: 2048 },
    { usage: 'draft' as const, maxTokens: 8192, expected: 8192 },
    { usage: 'reasoning' as const, maxTokens: undefined, expected: 4096 },
    { usage: 'reasoning' as const, maxTokens: 8192, expected: 8192 },
  ])(
    '$usage 输出上限 $maxTokens 最终序列化为 $expected',
    async ({ usage, maxTokens, expected }) => {
      const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(response({ content: '正文' }));

      await expect(service().complete(messages, { usage, maxTokens })).resolves.toMatchObject({
        content: '正文',
        finishReason: 'stop',
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(String(url)).toBe(`${config.baseUrl}/chat/completions`);
      const body = JSON.parse(init!.body as string);
      expect(body).toMatchObject({
        model: config.usages[usage].model,
        max_tokens: expected,
        messages,
        thinking: { type: usage === 'draft' ? 'disabled' : 'enabled' },
      });
      expect(body.tools).toBeUndefined();
      expect(body.response_format).toBeUndefined();
    },
  );

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
      service().completeStructured(schema, messages, { usage: 'reasoning', maxTokens: 8192 }),
    ).resolves.toEqual({ title: '书名' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(body!).toMatchObject({
      model: config.usages.reasoning.model,
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

  it.each([
    { structured: false, explicit: false },
    { structured: true, explicit: false },
    { structured: false, explicit: true },
    { structured: true, explicit: true },
  ])(
    '取消到达 HTTP 传输（结构化=$structured，显式信号=$explicit）',
    async ({ structured, explicit }) => {
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
      const llm = service();
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
