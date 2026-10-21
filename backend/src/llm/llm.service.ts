import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompleteOptions {
  model?: string;
  maxTokens?: number;
  /** 开启思维链（会占用 max_tokens 预算），默认关闭 */
  thinking?: boolean;
}

export interface CompletionResult {
  model: string;
  content: string;
  reasoning?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI;

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      baseURL: this.configService.get<string>('llm.baseUrl'),
      apiKey: this.configService.get<string>('llm.apiKey') || 'not-configured',
    });
  }

  onModuleInit(): void {
    if (!this.configService.get<string>('llm.apiKey')) {
      this.logger.warn('DEEPSEEK_API_KEY 未配置，LLM 功能暂不可用（服务正常启动）');
    }
  }

  hasApiKey(): boolean {
    return Boolean(this.configService.get<string>('llm.apiKey'));
  }

  async complete(
    messages: ChatMessage[],
    options: CompleteOptions = {},
  ): Promise<CompletionResult> {
    const model = options.model ?? this.configService.get<string>('llm.model') ?? 'deepseek-flash';

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 1024,
    };
    if (options.thinking) {
      // thinking 为 DeepSeek 扩展参数，OpenAI SDK 类型中未定义，显式注入
      (params as unknown as Record<string, unknown>).thinking = { type: 'enabled' };
    }

    const completion = await this.client.chat.completions.create(params);
    const message = completion.choices[0]?.message;

    return {
      model: completion.model,
      content: message?.content ?? '',
      reasoning:
        (message as { reasoning_content?: string } | undefined)?.reasoning_content || undefined,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
    };
  }

  /**
   * 预留：流式补全。SSE 端到端不在本 change 范围内，
   * 真实实现留给后续 change（见 design.md 决策 5）。
   */
  // eslint-disable-next-line require-yield -- 预留签名，实现 SSE 时改为产出 chunk
  async *stream(_messages: ChatMessage[], _options: CompleteOptions = {}): AsyncGenerator<string> {
    throw new Error('stream() 尚未实现，留给后续 change');
  }
}
