import {
  BadGatewayException,
  Controller,
  Logger,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';
import { PingResponse } from '@rill/shared';

@Controller('llm')
export class LlmController {
  private readonly logger = new Logger(LlmController.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly configService: ConfigService,
  ) {}

  @Post('ping')
  async ping(): Promise<PingResponse> {
    if (!this.llmService.hasApiKey()) {
      throw new ServiceUnavailableException('LLM 未配置：请在后端 .env 中设置 DEEPSEEK_API_KEY');
    }

    try {
      const result = await this.llmService.complete(
        [{ role: 'user', content: '请回复两个字：收到' }],
        { maxTokens: 256 },
      );
      return { ok: true, model: result.model, content: result.content };
    } catch (error) {
      // 只透传失败原因，绝不在日志或响应中暴露 API key
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`LLM 调用失败: ${reason}`);
      throw new BadGatewayException(`LLM 调用失败: ${reason}`);
    }
  }
}
