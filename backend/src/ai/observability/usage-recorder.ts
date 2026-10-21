import { Inject, Injectable } from '@nestjs/common';
import { AI_CONFIG, AiConfig } from '../config/ai.config';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface UsageRecord {
  traceId: string;
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCost: number | null;
}

interface LangChainLlmOutput {
  llmOutput?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } };
  generations?: Array<
    Array<{ message?: { usage_metadata?: { input_tokens?: number; output_tokens?: number } } }>
  >;
}

function extractTokenUsage(output: unknown): TokenUsage {
  const candidate = (output ?? {}) as LangChainLlmOutput;

  const fromLlmOutput = candidate.llmOutput?.tokenUsage;
  if (fromLlmOutput) {
    return {
      promptTokens: fromLlmOutput.promptTokens ?? 0,
      completionTokens: fromLlmOutput.completionTokens ?? 0,
    };
  }

  const metadata = candidate.generations?.[0]?.[0]?.message?.usage_metadata;
  if (metadata) {
    return {
      promptTokens: metadata.input_tokens ?? 0,
      completionTokens: metadata.output_tokens ?? 0,
    };
  }

  return { promptTokens: 0, completionTokens: 0 };
}

/**
 * 用量与成本记录。重试产生的多次调用按 traceId 聚合为一条记录，
 * 避免统计重复计数。
 */
@Injectable()
export class UsageRecorder {
  private readonly records = new Map<string, UsageRecord>();

  constructor(@Inject(AI_CONFIG) private readonly config: AiConfig) {}

  /** 为单次模型调用创建 LangChain 回调（每次调用一个实例） */
  callbacks(traceId: string, model: string) {
    const startedAt = Date.now();
    return {
      handleLLMEnd: (output: unknown): void => {
        const usage = extractTokenUsage(output);
        this.merge(traceId, model, usage, Date.now() - startedAt);
      },
      handleLLMError: (): void => {
        this.merge(
          traceId,
          model,
          { promptTokens: 0, completionTokens: 0 },
          Date.now() - startedAt,
        );
      },
    };
  }

  merge(traceId: string, model: string, usage: TokenUsage, durationMs: number): void {
    const existing = this.records.get(traceId);
    const record: UsageRecord = existing ?? {
      traceId,
      model,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      durationMs: 0,
      estimatedCost: null,
    };

    record.model = model;
    record.calls += 1;
    record.promptTokens += usage.promptTokens;
    record.completionTokens += usage.completionTokens;
    record.totalTokens = record.promptTokens + record.completionTokens;
    record.durationMs += durationMs;
    record.estimatedCost = this.estimateCost(record);

    this.records.set(traceId, record);
  }

  get(traceId: string): UsageRecord | undefined {
    return this.records.get(traceId);
  }

  private estimateCost(record: UsageRecord): number | null {
    const { inputPerMTokens, outputPerMTokens } = this.config.pricing;
    if (inputPerMTokens === null || outputPerMTokens === null) return null;
    const inputCost = (record.promptTokens / 1_000_000) * inputPerMTokens;
    const outputCost = (record.completionTokens / 1_000_000) * outputPerMTokens;
    return Number((inputCost + outputCost).toFixed(6));
  }
}
