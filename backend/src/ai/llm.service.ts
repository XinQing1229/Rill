import { BadGatewayException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AI_CONFIG, AiConfig, ModelUsage } from './config/ai.config';
import { ModelRegistry } from './models/model.registry';
import { PromptRegistry } from './prompts/prompt.registry';
import { sampleBookV1 } from './prompts/templates/sample-book';
import { UsageRecorder } from './observability/usage-recorder';
import { newTraceId } from './observability/trace';
import { createLlmCallGraph } from './graphs/llm-call.graph';
import { BudgetExceededError } from './errors/error-classifier';
import type {
  ChatMessage,
  CompleteOptions,
  CompletionResult,
  StructuredOptions,
} from './llm.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = any;

/** 从错误中取出可读原因；绝不回传可能包含密钥的原文 */
function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    private readonly registry: ModelRegistry,
    private readonly prompts: PromptRegistry,
    private readonly usage: UsageRecorder,
  ) {
    this.prompts.register(sampleBookV1);
  }

  onModuleInit(): void {
    if (!this.config.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY 未配置，LLM 功能暂不可用（服务正常启动）');
    }
  }

  hasApiKey(): boolean {
    return Boolean(this.config.apiKey);
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
    const usageKind: ModelUsage = options.usage ?? 'draft';
    const resolved = this.registry.resolve(usageKind);

    try {
      const response = await this.runWithRetry(traceId, () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolved.model.invoke(messages as any, {
          callbacks: [this.usage.callbacks(traceId, resolved.modelName)],
          ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
        }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const message = response as any;
      const tokenUsage = message?.usage_metadata;

      return {
        model: resolved.modelName,
        content: message?.content ?? '',
        reasoning: message?.additional_kwargs?.reasoning_content || undefined,
        usage: tokenUsage
          ? {
              promptTokens: tokenUsage.input_tokens ?? 0,
              completionTokens: tokenUsage.output_tokens ?? 0,
              totalTokens: (tokenUsage.input_tokens ?? 0) + (tokenUsage.output_tokens ?? 0),
            }
          : undefined,
        traceId,
        usageKind,
      };
    } finally {
      this.logUsage(traceId);
    }
  }

  /**
   * 结构化生成：按 schema 校验输出，失败时回喂错误修复重试。
   * 结构化生成一律关闭思维链（避免推理占用输出预算）。
   */
  async completeStructured<T>(
    schema: AnySchema,
    messages: ChatMessage[],
    options: StructuredOptions = {},
  ): Promise<T> {
    const traceId = options.traceId ?? newTraceId();
    const usageKind: ModelUsage = options.usage ?? 'draft';
    const resolved = this.registry.resolve(usageKind, { thinking: false });
    const runnable = resolved.model.withStructuredOutput(schema);

    const maxRepairAttempts = options.maxRepairAttempts ?? this.config.structured.maxRepairAttempts;
    let currentMessages: ChatMessage[] = messages;
    let lastError: unknown;

    try {
      for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
        try {
          const result = await this.runWithRetry(traceId, () =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            runnable.invoke(currentMessages as any, {
              callbacks: [this.usage.callbacks(traceId, resolved.modelName)],
            }),
          );
          return result as T;
        } catch (error) {
          lastError = error;
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
  private async runWithRetry<T>(traceId: string, call: () => Promise<T>): Promise<T> {
    const budget = this.config.budget.maxCallsPerRequest;
    let calls = 0;

    const guarded = async (): Promise<T> => {
      if (calls >= budget) {
        throw new BudgetExceededError(budget);
      }
      calls += 1;
      return call();
    };

    const graph = createLlmCallGraph(this.config.retry);
    const output = await graph.invoke({ call: guarded, result: undefined });
    return output.result as T;
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
