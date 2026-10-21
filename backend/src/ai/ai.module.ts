import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_CONFIG, parseAiConfig } from './config/ai.config';
import { ModelRegistry } from './models/model.registry';
import { PromptRegistry } from './prompts/prompt.registry';
import { UsageRecorder } from './observability/usage-recorder';
import { LlmService } from './llm.service';

@Module({
  providers: [
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
  exports: [LlmService, UsageRecorder, PromptRegistry],
})
export class AiModule {}
