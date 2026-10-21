import { z } from 'zod';

export const MODEL_USAGES = ['draft', 'reasoning'] as const;
export type ModelUsage = (typeof MODEL_USAGES)[number];

const UsageSchema = z.object({
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  timeout: z.number().int().positive(),
  thinking: z.boolean(),
});

export const AiConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string(),
  usages: z.object({
    draft: UsageSchema,
    reasoning: UsageSchema,
  }),
  retry: z.object({
    maxAttempts: z.number().int().positive(),
    initialInterval: z.number().int().positive(),
    backoffFactor: z.number().positive(),
    maxInterval: z.number().int().positive(),
    jitter: z.boolean(),
  }),
  structured: z.object({
    maxRepairAttempts: z.number().int().nonnegative(),
  }),
  budget: z.object({
    maxCallsPerRequest: z.number().int().positive(),
  }),
  pricing: z.object({
    inputPerMTokens: z.number().nonnegative().nullable(),
    outputPerMTokens: z.number().nonnegative().nullable(),
  }),
});

export type AiConfig = z.infer<typeof AiConfigSchema>;
export type UsageConfig = z.infer<typeof UsageSchema>;

export const AI_CONFIG = Symbol('AI_CONFIG');

/** 启动时校验配置，缺失或非法即刻抛出，避免运行到调用时才失败 */
export function parseAiConfig(raw: unknown): AiConfig {
  const result = AiConfigSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`AI 配置校验失败（LLM_* / DEEPSEEK_* 环境变量）: ${details}`);
  }
  return result.data;
}
