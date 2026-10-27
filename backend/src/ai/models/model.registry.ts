import { Inject, Injectable, Optional } from '@nestjs/common';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatDeepSeek } from '@langchain/deepseek';
import { ChatOpenAI } from '@langchain/openai';
import { AI_CONFIG, type AiConfig } from '../config/ai.config.js';
import { KeySettingsService } from '../key-settings.service.js';

export interface ResolvedModel {
  model: BaseChatModel;
  provider: 'deepseek' | 'glm';
  modelName: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

/** 单次调用覆盖项。输出上限必须落在构造参数上，invoke 选项会被 SDK 忽略。 */
export interface ResolveOverrides {
  maxTokens?: number;
}

@Injectable()
export class ModelRegistry {
  constructor(
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Optional() private readonly settings?: KeySettingsService,
  ) {}

  /** 按已保存的当前模型和凭据解析一次调用快照。 */
  resolve(overrides: ResolveOverrides = {}): ResolvedModel {
    const active = this.settings?.active() ?? {
      provider: 'deepseek' as const,
      apiKey: this.config.providers.deepseek.apiKey || 'not-configured',
      baseUrl: this.config.providers.deepseek.baseUrl,
      model: this.config.providers.deepseek.model,
      temperature: this.config.defaults.temperature,
      maxTokens: this.config.defaults.maxTokens,
      timeout: this.config.defaults.timeout,
    };
    const providerConfig = this.config.providers[active.provider];
    const temperature = Math.min(
      providerConfig.maxTemperature,
      Math.max(providerConfig.minTemperature, active.temperature),
    );
    const options = {
      apiKey: active.apiKey,
      configuration: { baseURL: active.baseUrl },
      model: active.model,
      temperature,
      maxTokens: overrides.maxTokens ?? active.maxTokens,
      timeout: active.timeout,
      // 重试由 LlmService 统一计数，避免 SDK 内部再放大请求次数。
      maxRetries: 0,
    };
    const model =
      active.provider === 'deepseek'
        ? new ChatDeepSeek({
            ...options,
            modelKwargs: { thinking: { type: 'disabled' } },
          })
        : new ChatOpenAI({
            ...options,
            // GLM-5.3 强制思考，使用低推理强度为正文/工具参数保留输出预算。
            modelKwargs: { thinking: { type: 'enabled' }, reasoning_effort: 'low' },
          });

    return {
      model,
      provider: active.provider,
      modelName: active.model,
      temperature,
      maxTokens: options.maxTokens,
      timeoutMs: active.timeout,
    };
  }
}
