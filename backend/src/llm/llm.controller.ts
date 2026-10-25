import { extractStatus } from '../ai/errors/error-classifier.js';
import { Body, Get, Header, Headers, ForbiddenException } from '@nestjs/common';
import { ApiKeyUpdateSchema, type ApiKeyUpdate } from '@rill/shared';
import { KeySettingsService } from '../ai/key-settings.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
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

  constructor(
    private readonly llmService: LlmService,
    private readonly settings: KeySettingsService,
  ) {}

  @Get('settings')
  @Header('Cache-Control', 'no-store')
  getSettings() {
    return this.settings.state();
  }

  @Post('settings')
  @Header('Cache-Control', 'no-store')
  updateSettings(
    @Body(new ZodValidationPipe(ApiKeyUpdateSchema)) body: ApiKeyUpdate,
    @Headers('origin') origin?: string,
    @Headers('host') host?: string,
  ) {
    // 允许同源页面和本地 Vite 开发页，拒绝其他网站修改服务端密钥。
    if (origin) {
      let allowed = false;
      try {
        const url = new URL(origin);
        allowed = ['http:', 'https:'].includes(url.protocol) && url.host === host;
        if (!allowed && host && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) {
          allowed = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):5173$/.test(origin);
        }
      } catch {
        /* 非法 Origin 一律拒绝。 */
      }
      if (!allowed) throw new ForbiddenException('不允许从其他网站修改 API Key');
    }
    return this.settings.update(body);
  }

  @Post('ping')
  async ping(): Promise<PingResponse> {
    // 走 draft 用途并贯穿 traceId，使该端点同时验证基建链路本身
    const traceId = newTraceId();

    if (!this.llmService.hasApiKey()) {
      this.logger.warn(`traceId=${traceId} LLM 未配置`);
      throw new ServiceUnavailableException('LLM 未配置：请在“API Key 设置”页面配置密钥');
    }

    try {
      const result = await this.llmService.complete(
        [{ role: 'user', content: '请回复两个字：收到' }],
        { usage: 'draft', traceId, maxTokens: 256 },
      );
      return { ok: true, model: result.model, content: result.content };
    } catch (error) {
      // 只透传失败原因，绝不在日志或响应中暴露 API key
      const status = extractStatus(error);
      const reason =
        status === 401 || status === 403
          ? '认证失败，请检查 API Key'
          : status === 429
            ? '请求过于频繁，请稍后重试'
            : '模型服务暂不可用，请检查配置后重试';
      this.logger.error(`traceId=${traceId} LLM 调用失败: ${reason}`);
      throw new BadGatewayException(`LLM 调用失败: ${reason}`);
    }
  }
}
