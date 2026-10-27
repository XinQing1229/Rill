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
    // 测试连接应在有限时间内结束，避免界面一直处于加载状态。
    const traceId = newTraceId();
    const timeoutMs = 20_000;
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`模型连接测试超时（${timeoutMs / 1000} 秒）`));
        }, timeoutMs);
      });
      const result = await Promise.race([
        this.llmService.complete([{ role: 'user', content: '请回复两个字：收到' }], {
          traceId,
          maxTokens: 256,
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
      return { ok: true, model: result.model, content: result.content };
    } catch (error) {
      // 只回传分类后的失败原因，绝不暴露 API key 或供应商原始响应正文。
      const status = extractStatus(error);
      if (error instanceof ServiceUnavailableException) throw error;
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
      const timedOut =
        errorMessage.includes('timeout') ||
        errorMessage.includes('timed out') ||
        errorMessage.includes('超时') ||
        errorMessage.includes('aborted');
      const reason =
        status === 401 || status === 403
          ? '认证失败，请检查当前服务商的 API Key'
          : status === 429
            ? '请求过于频繁或额度不足，请检查账号额度后重试'
            : status === 400 || status === 404
              ? `模型服务拒绝了请求（HTTP ${status}），请检查模型名和请求配置`
              : timedOut
                ? `连接模型服务超时（${timeoutMs / 1000} 秒），请检查网络或稍后重试`
                : status && status >= 500
                  ? `模型服务暂时异常（HTTP ${status}），请稍后重试`
                  : '无法连接模型服务，请检查网络、服务地址和 API Key';
      this.logger.error(
        `traceId=${traceId} LLM 调用失败 status=${status ?? 'unknown'} reason=${reason}`,
      );
      throw new BadGatewayException(`LLM 调用失败: ${reason}`);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
