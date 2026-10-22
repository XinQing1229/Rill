import {
  BadGatewayException,
  Controller,
  Logger,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LlmService } from '../ai/llm.service.js';
import { newTraceId } from '../ai/observability/trace.js';
import { PingResponse } from '@rill/shared';

@Controller('llm')
export class LlmController {
  private readonly logger = new Logger(LlmController.name);

  constructor(private readonly llmService: LlmService) {}

  @Post('ping')
  async ping(): Promise<PingResponse> {
    // 走 draft 用途并贯穿 traceId，使该端点同时验证基建链路本身
    const traceId = newTraceId();

    if (!this.llmService.hasApiKey()) {
      this.logger.warn(`traceId=${traceId} LLM 未配置`);
      throw new ServiceUnavailableException('LLM 未配置：请在后端 .env 中设置 DEEPSEEK_API_KEY');
    }

    try {
      const result = await this.llmService.complete(
        [{ role: 'user', content: '请回复两个字：收到' }],
        { usage: 'draft', traceId, maxTokens: 256 },
      );
      return { ok: true, model: result.model, content: result.content };
    } catch (error) {
      // 只透传失败原因，绝不在日志或响应中暴露 API key
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`traceId=${traceId} LLM 调用失败: ${reason}`);
      throw new BadGatewayException(`LLM 调用失败: ${reason}`);
    }
  }
}
