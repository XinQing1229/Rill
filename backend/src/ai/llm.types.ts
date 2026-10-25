export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompleteOptions {
  signal?: AbortSignal;
  /** 模型用途，决定模型与参数；默认 draft */
  usage?: 'draft' | 'reasoning';
  /** 外部传入的追踪标识；不传则自动生成 */
  traceId?: string;
  /** 覆盖用途默认的最大输出 token */
  maxTokens?: number;
}

export interface StructuredOptions extends CompleteOptions {
  /** 完整正文修订不接受已知被供应商截断的结构化输出。 */
  rejectTruncated?: boolean;
  /** 修复重试次数上限；不传则使用配置值 */
  maxRepairAttempts?: number;
}

export interface CompletionResult {
  /** 模型停止原因，用于识别正文截断。 */
  finishReason?: string;
  model: string;
  content: string;
  reasoning?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  traceId: string;
  /** 记录该次调用实际使用的模型（便于追踪降级/回退） */
  usageKind: 'draft' | 'reasoning';
}
