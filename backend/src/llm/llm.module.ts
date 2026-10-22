import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { LlmController } from './llm.controller.js';

@Module({
  imports: [AiModule],
  controllers: [LlmController],
})
export class LlmModule {}
