import { Inject, Injectable } from '@nestjs/common';
import { ChatDeepSeek } from '@langchain/deepseek';
import { AI_CONFIG, AiConfig, ModelUsage, UsageConfig } from '../config/ai.config.js';

export interface ResolvedModel {
  model: ChatDeepSeek;
  modelName: string;
  thinking: boolean;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface ChatModelOptions {
  apiKey: string;
  configuration: { baseURL: string };
  model: string;
  temperature: number;
  maxTokens: number;
  timeout: number;
  modelKwargs: { thinking: { type: 'enabled' | 'disabled' } };
}

/** 调用级覆盖：思维链开关与单次输出上限（maxTokens 必须落在构造参数上，invoke 选项会被 SDK 忽略） */
export interface ResolveOverrides {
  thinking?: boolean;
  maxTokens?: number;
}

/**
 * 构造模型参数。思维链开关**永远显式指定**——
 * 实测表明不传该参数时模型行为不确定（同一模型出现过一次推理、一次不推理）。
 */
export function buildChatModelOptions(
  config: AiConfig,
  usageConfig: UsageConfig,
  overrides: ResolveOverrides = {},
): ChatModelOptions {
  const thinking = overrides.thinking ?? usageConfig.thinking;
  return {
    apiKey: config.apiKey || 'not-configured',
    configuration: { baseURL: config.baseUrl },
    model: usageConfig.model,
    temperature: usageConfig.temperature,
    maxTokens: overrides.maxTokens ?? usageConfig.maxTokens,
    timeout: usageConfig.timeout,
    modelKwargs: { thinking: { type: thinking ? 'enabled' : 'disabled' } },
  };
}

@Injectable()
export class ModelRegistry {
  constructor(@Inject(AI_CONFIG) private readonly config: AiConfig) {}

  /**
   * 按用途解析模型。overrides.thinking 用于结构化生成强制关闭思维链；
   * overrides.maxTokens 用于调用级输出上限（如大纲生成的 OUTLINE_MAX_TOKENS）。
   */
  resolve(usage: ModelUsage, overrides: ResolveOverrides = {}): ResolvedModel {
    const usageConfig = this.config.usages[usage];
    const options = buildChatModelOptions(this.config, usageConfig, overrides);
    const thinking = overrides.thinking ?? usageConfig.thinking;

    return {
      model: new ChatDeepSeek(options),
      modelName: usageConfig.model,
      thinking,
      temperature: usageConfig.temperature,
      maxTokens: overrides.maxTokens ?? usageConfig.maxTokens,
      timeoutMs: usageConfig.timeout,
    };
  }
}
