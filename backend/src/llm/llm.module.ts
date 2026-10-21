import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { LlmController } from './llm.controller';

@Module({
  imports: [AiModule],
  controllers: [LlmController],
})
export class LlmModule {}
