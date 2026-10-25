import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { type ApiKeySettings, type ApiKeyUpdate, ApiKeyUpdateSchema } from '@rill/shared';
import { AI_CONFIG, type AiConfig } from './config/ai.config.js';

export const API_KEY_ENV_PATH = Symbol('API_KEY_ENV_PATH');

/** 源码与构建入口均定位 backend/.env，不依赖启动工作目录。 */
export function backendEnvPath(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(directory, 'prisma/schema.prisma'))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error('无法定位后端配置目录');
    directory = parent;
  }
  return join(directory, '.env');
}

@Injectable()
export class KeySettingsService {
  private saving = false;
  constructor(
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Inject(API_KEY_ENV_PATH) private readonly envPath: string,
  ) {}

  state(): ApiKeySettings {
    return {
      hasApiKey: Boolean(this.config.apiKey),
      baseUrl: this.config.baseUrl,
      draftModel: this.config.usages.draft.model,
      reasoningModel: this.config.usages.reasoning.model,
    };
  }

  /** 原子更新环境文件；磁盘写入成功后才更新共享运行配置，不调用模型。 */
  async update(input: ApiKeyUpdate): Promise<ApiKeySettings> {
    const value = ApiKeyUpdateSchema.parse(input);
    if (this.saving) throw new ConflictException('正在保存配置，请稍后重试');
    this.saving = true;
    const temporary = `${this.envPath}.${randomUUID()}.tmp`;
    try {
      let contents = '';
      try {
        const stat = await lstat(this.envPath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('配置文件类型错误');
        contents = await readFile(this.envPath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const apiKey = value.action === 'replace' ? value.apiKey : '';
      const line = `DEEPSEEK_API_KEY="${apiKey}"`;
      const pattern = /^[ \t]*(?:export[ \t]+)?DEEPSEEK_API_KEY[ \t]*=.*$/gm;
      const next = pattern.test(contents)
        ? contents.replace(pattern, () => line)
        : `${contents}${contents && !contents.endsWith('\n') ? '\n' : ''}${line}\n`;
      await writeFile(temporary, next, { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.envPath);
      this.config.apiKey = apiKey;
      process.env.DEEPSEEK_API_KEY = apiKey;
      return this.state();
    } catch {
      throw new ServiceUnavailableException('API Key 保存失败，请检查后端配置目录权限后重试');
    } finally {
      await unlink(temporary).catch(() => undefined);
      this.saving = false;
    }
  }
}
