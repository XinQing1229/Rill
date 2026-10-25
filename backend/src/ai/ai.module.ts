import { API_KEY_ENV_PATH, backendEnvPath, KeySettingsService } from './key-settings.service.js';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_CONFIG, parseAiConfig } from './config/ai.config.js';
import { ModelRegistry } from './models/model.registry.js';
import { PromptRegistry } from './prompts/prompt.registry.js';
import { UsageRecorder } from './observability/usage-recorder.js';
import { LlmService } from './llm.service.js';

@Module({
  providers: [
    { provide: API_KEY_ENV_PATH, useFactory: backendEnvPath },
    KeySettingsService,
    {
      provide: AI_CONFIG,
      inject: [ConfigService],
      // 启动时校验配置，缺失或非法即刻失败
      useFactory: (configService: ConfigService) => parseAiConfig(configService.get('llm')),
    },
    ModelRegistry,
    PromptRegistry,
    UsageRecorder,
    LlmService,
  ],
  exports: [KeySettingsService, LlmService, UsageRecorder, PromptRegistry],
})
export class AiModule {}
