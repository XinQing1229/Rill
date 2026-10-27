import { executionContext } from '../novel/pipeline/execution-context.js';
import { z } from 'zod';
import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { AI_CONFIG, AiConfig } from './config/ai.config.js';
import { ModelRegistry } from './models/model.registry.js';
import { PromptRegistry } from './prompts/prompt.registry.js';
import { sampleBookV1 } from './prompts/templates/sample-book.js';
import { UsageRecorder } from './observability/usage-recorder.js';
import { newTraceId } from './observability/trace.js';
import { createLlmCallGraph } from './graphs/llm-call.graph.js';
import { BudgetExceededError, isOutputParseError } from './errors/error-classifier.js';
import type {
  ChatMessage,
  CompleteOptions,
  CompletionResult,
  StructuredOptions,
} from './llm.types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = any;

/** 从错误中取出可读原因；绝不回传可能包含密钥的原文 */
function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    private readonly registry: ModelRegistry,
    private readonly prompts: PromptRegistry,
    private readonly usage: UsageRecorder,
  ) {
    this.prompts.register(sampleBookV1);
  }

  /** 渲染已注册的提示词模板 */
  renderPrompt(name: string, version: string, variables: Record<string, string>): string {
    return this.prompts.render(name, version, variables);
  }

  async complete(
    messages: ChatMessage[],
    options: CompleteOptions = {},
  ): Promise<CompletionResult> {
    const traceId = options.traceId ?? newTraceId();
    const signal = options.signal ?? executionContext.getStore()?.signal;
    const runWithRetry = this.retryRunner(signal);
    // 输出上限必须用于构造模型，当前 SDK 会忽略 invoke 中的 maxTokens。
    const resolved = this.registry.resolve({
      ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
    });

    try {
      const response = await runWithRetry(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolved.model.invoke(messages as any, {
          signal,
          callbacks: [this.usage.callbacks(traceId, resolved.modelName, resolved.provider)],
        }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const message = response as any;
      const tokenUsage = message?.usage_metadata;

      return {
        model: resolved.modelName,
        content: message?.content ?? '',
        finishReason: message?.response_metadata?.finish_reason,
        usage: tokenUsage
          ? {
              promptTokens: tokenUsage.input_tokens ?? 0,
              completionTokens: tokenUsage.output_tokens ?? 0,
              totalTokens: (tokenUsage.input_tokens ?? 0) + (tokenUsage.output_tokens ?? 0),
            }
          : undefined,
        traceId,
      };
    } finally {
      this.logUsage(traceId);
    }
  }

  /**
   * 结构化生成：按 schema 校验输出，失败时回喂错误修复重试。
   * DeepSeek 关闭思考，GLM-5.3 保留其必需的思考并限制推理强度。
   */
  async completeStructured<T>(
    schema: AnySchema,
    messages: ChatMessage[],
    options: StructuredOptions = {},
  ): Promise<T> {
    const traceId = options.traceId ?? newTraceId();
    const signal = options.signal ?? executionContext.getStore()?.signal;
    // 修复循环与网络重试共享同一个预算。
    const runWithRetry = this.retryRunner(signal);
    // maxTokens 必须落在模型构造参数上：invoke 选项中的 maxTokens 会被 ChatDeepSeek 忽略
    const resolved = this.registry.resolve({
      ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
    });
    // 联合类型的 JSON Schema 根节点只有 anyOf/oneOf，DeepSeek 工具参数要求根节点为 object。
    // 仅在传输层包装，解包后仍按原始契约校验，业务调用方无需改变返回结构。
    const wrapped = schema instanceof z.ZodUnion;
    const runnable = resolved.model.withStructuredOutput(
      wrapped ? z.object({ result: schema }) : schema,
      { method: 'functionCalling' },
    );

    const maxRepairAttempts = options.maxRepairAttempts ?? this.config.structured.maxRepairAttempts;
    let currentMessages: ChatMessage[] = messages;
    let lastError: unknown;

    try {
      for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
        let truncated = false;
        try {
          const result = await runWithRetry(() =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            runnable.invoke(currentMessages as any, {
              signal,
              callbacks: [
                this.usage.callbacks(traceId, resolved.modelName, resolved.provider),
                {
                  handleLLMEnd: (output: unknown) => {
                    const result = output as {
                      generations?: Array<
                        Array<{
                          generationInfo?: { finish_reason?: string };
                          message?: { response_metadata?: { finish_reason?: string } };
                        }>
                      >;
                    };
                    if (
                      result.generations?.some((group) =>
                        group.some(
                          (g) =>
                            (g.generationInfo?.finish_reason ??
                              g.message?.response_metadata?.finish_reason) === 'length',
                        ),
                      )
                    )
                      truncated = true;
                  },
                },
              ],
            }),
          );
          if (options.rejectTruncated && truncated)
            throw new BadGatewayException('正文修改输出被截断，请重试');
          // 在修复循环内校验，确保数量、长度等生成约束失败后也能回喂重试。
          return schema.parse(wrapped ? (result as { result: unknown }).result : result) as T;
        } catch (error) {
          lastError = error;
          signal?.throwIfAborted();
          // 仅修复输出：网络、认证、限流等错误已由统一重试处理。
          if (!isOutputParseError(error) && !(error instanceof z.ZodError) && !truncated)
            throw error;
          if (attempt === maxRepairAttempts) break;
          currentMessages = [
            ...currentMessages,
            {
              role: 'user',
              content: `上一次输出未通过结构校验：${reasonOf(error)}。请严格按照要求的结构重新输出，不要输出任何多余内容。`,
            },
          ];
        }
      }
      throw new BadGatewayException(`结构化生成失败: ${reasonOf(lastError)}`);
    } finally {
      this.logUsage(traceId);
    }
  }

  /**
   * 预留：流式补全。SSE 端到端不在本 change 范围内，
   * 真实实现留给后续 change。
   */
  // eslint-disable-next-line require-yield -- 预留签名，实现 SSE 时改为产出 chunk
  async *stream(): AsyncGenerator<string> {
    throw new Error('stream() 尚未实现，留给后续 change');
  }

  /**
   * 经 LangGraph 节点重试执行单次调用，并受总调用预算约束——
   * 避免内层修复重试与外层节点重试叠加导致调用次数失控。
   */
  private retryRunner(signal?: AbortSignal) {
    const budget = this.config.budget.maxCallsPerRequest;
    let calls = 0;

    return async <T>(call: () => Promise<T>): Promise<T> => {
      const guarded = async (): Promise<T> => {
        signal?.throwIfAborted();
        if (calls >= budget) throw new BudgetExceededError(budget);
        calls += 1;
        return call();
      };

      const graph = createLlmCallGraph(this.config.retry);
      const output = await graph.invoke({ call: guarded, result: undefined }, { signal });
      return output.result as T;
    };
  }

  /** 汇总日志：不含 API key，完整 prompt 默认不记录 */
  private logUsage(traceId: string): void {
    const record = this.usage.get(traceId);
    if (!record) return;
    this.logger.log(
      `traceId=${record.traceId} model=${record.model} calls=${record.calls} ` +
        `tokens=${record.promptTokens}in/${record.completionTokens}out ` +
        `durationMs=${record.durationMs} cost=${record.estimatedCost ?? 'n/a'}`,
    );
  }
}
