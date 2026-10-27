import {
  ConflictException,
  Inject,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ApiKeySettings,
  type ApiKeyUpdate,
  ApiKeyUpdateSchema,
  type ModelProvider,
} from '@rill/shared';
import { AI_CONFIG, type AiConfig } from './config/ai.config.js';
import { PrismaService } from '../novel/prisma.service.js';

export const API_KEY_ENV_PATH = Symbol('API_KEY_ENV_PATH');
const SETTINGS_ID = 'global';
const PROVIDERS: ModelProvider[] = ['deepseek', 'glm'];

export interface ActiveModelSettings {
  provider: ModelProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeout: number;
}

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
export class KeySettingsService implements OnModuleInit {
  private saving = false;
  private activeProvider: ModelProvider = 'deepseek';
  private activeModel = 'deepseek-flash';
  private stored: Awaited<ReturnType<PrismaService['aiSettings']['findUnique']>> = null;
  private readonly decryptedKeys: Partial<Record<ModelProvider, string>> = {};
  private readonly decryptionErrors = new Set<ModelProvider>();

  constructor(
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Inject(API_KEY_ENV_PATH) private readonly envPath: string,
    private readonly prisma: PrismaService,
  ) {
    this.activeModel = this.config.providers.deepseek.model;
  }

  async onModuleInit(): Promise<void> {
    this.stored = await this.prisma.aiSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!this.stored) return;

    if (PROVIDERS.includes(this.stored.activeProvider as ModelProvider)) {
      this.activeProvider = this.stored.activeProvider as ModelProvider;
      this.activeModel = this.stored.activeModel;
    }
    for (const provider of PROVIDERS) {
      if (this.hasEncryptedKey(this.stored, provider)) {
        try {
          this.decryptedKeys[provider] = this.decryptKey(this.stored, provider);
        } catch {
          this.decryptionErrors.add(provider);
        }
      }
    }
  }

  state(): ApiKeySettings {
    return {
      activeProvider: this.activeProvider,
      activeModel: this.activeModel,
      providers: {
        deepseek: this.providerState('deepseek'),
        glm: this.providerState('glm'),
      },
    };
  }

  active(): ActiveModelSettings {
    const provider = this.activeProvider;
    const config = this.config.providers[provider];
    if (this.decryptionErrors.has(provider)) {
      throw new ServiceUnavailableException(
        `${provider === 'glm' ? 'GLM' : 'DeepSeek'} 用户设置的 API Key 无法解密，请重新保存该密钥`,
      );
    }
    const apiKey = this.decryptedKeys[provider] ?? config.apiKey;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        `未配置${provider === 'glm' ? 'GLM' : 'DeepSeek'} API Key，请在模型设置页配置密钥`,
      );
    }
    return {
      provider,
      apiKey,
      baseUrl: config.baseUrl,
      model: this.activeModel,
      temperature: this.config.defaults.temperature,
      maxTokens: this.config.defaults.maxTokens,
      timeout: this.config.defaults.timeout,
    };
  }

  async update(input: ApiKeyUpdate): Promise<ApiKeySettings> {
    const value = ApiKeyUpdateSchema.parse(input);
    if (this.saving) throw new ConflictException('正在保存模型设置，请稍后重试');
    this.saving = true;
    try {
      if (value.action === 'select-model') {
        const allowedModel = this.config.providers[value.provider].model;
        if (value.model !== allowedModel) {
          throw new ServiceUnavailableException('所选模型当前不可用，请刷新模型设置后重试');
        }
        const next = {
          ...(this.stored ?? this.emptyStoredSettings()),
          activeProvider: value.provider,
          activeModel: value.model,
        };
        await this.save(next);
        this.activeProvider = value.provider;
        this.activeModel = value.model;
      } else if (value.action === 'replace-key') {
        const encrypted = this.encryptKey(value.apiKey, await this.getEncryptionKey());
        const fieldPrefix = value.provider === 'glm' ? 'glmKey' : 'deepseekKey';
        const next = {
          ...(this.stored ?? this.emptyStoredSettings()),
          [`${fieldPrefix}Ciphertext`]: encrypted.ciphertext,
          [`${fieldPrefix}Nonce`]: encrypted.nonce,
          [`${fieldPrefix}AuthTag`]: encrypted.authTag,
        };
        await this.save(next);
        this.decryptedKeys[value.provider] = value.apiKey;
        this.decryptionErrors.delete(value.provider);
      } else {
        const fieldPrefix = value.provider === 'glm' ? 'glmKey' : 'deepseekKey';
        const next = {
          ...(this.stored ?? this.emptyStoredSettings()),
          [`${fieldPrefix}Ciphertext`]: null,
          [`${fieldPrefix}Nonce`]: null,
          [`${fieldPrefix}AuthTag`]: null,
        };
        await this.save(next);
        delete this.decryptedKeys[value.provider];
        this.decryptionErrors.delete(value.provider);
      }
      return this.state();
    } finally {
      this.saving = false;
    }
  }

  private providerState(provider: ModelProvider) {
    const hasUserKey = Boolean(this.stored && this.hasEncryptedKey(this.stored, provider));
    return {
      model: this.config.providers[provider].model,
      hasUserKey,
      keySource: hasUserKey
        ? ('user' as const)
        : this.config.providers[provider].apiKey
          ? ('env' as const)
          : ('none' as const),
    };
  }

  private emptyStoredSettings() {
    return {
      id: SETTINGS_ID,
      activeProvider: this.activeProvider,
      activeModel: this.activeModel,
      deepseekKeyCiphertext: null,
      deepseekKeyNonce: null,
      deepseekKeyAuthTag: null,
      glmKeyCiphertext: null,
      glmKeyNonce: null,
      glmKeyAuthTag: null,
      updatedAt: new Date(),
    };
  }

  private async save(data: Record<string, unknown>): Promise<void> {
    const saved = await this.prisma.aiSettings.upsert({
      where: { id: SETTINGS_ID },
      create: data as never,
      update: data as never,
    });
    this.stored = saved;
  }

  private hasEncryptedKey(data: NonNullable<typeof this.stored>, provider: ModelProvider): boolean {
    return Boolean(provider === 'glm' ? data.glmKeyCiphertext : data.deepseekKeyCiphertext);
  }

  private decryptKey(data: NonNullable<typeof this.stored>, provider: ModelProvider): string {
    const ciphertext = provider === 'glm' ? data.glmKeyCiphertext : data.deepseekKeyCiphertext;
    const nonce = provider === 'glm' ? data.glmKeyNonce : data.deepseekKeyNonce;
    const authTag = provider === 'glm' ? data.glmKeyAuthTag : data.deepseekKeyAuthTag;
    if (!ciphertext || !nonce || !authTag) throw new Error('密钥数据不完整');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.readEncryptionKey(),
      Buffer.from(nonce, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private encryptKey(apiKey: string, key: Buffer) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  private async getEncryptionKey(): Promise<Buffer> {
    if (!this.config.credentialEncryptionKey) {
      const generated = randomBytes(32).toString('base64');
      await this.persistEncryptionKey(generated);
      this.config.credentialEncryptionKey = generated;
      process.env.LLM_CREDENTIAL_ENCRYPTION_KEY = generated;
    }
    return this.readEncryptionKey();
  }

  private readEncryptionKey(): Buffer {
    const encoded = this.config.credentialEncryptionKey;
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded) {
      throw new ServiceUnavailableException(
        'LLM_CREDENTIAL_ENCRYPTION_KEY 格式无效，需为 32 字节的 Base64 值',
      );
    }
    return key;
  }

  private async persistEncryptionKey(key: string): Promise<void> {
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
      const line = `LLM_CREDENTIAL_ENCRYPTION_KEY="${key}"`;
      const pattern = /^[ \t]*(?:export[ \t]+)?LLM_CREDENTIAL_ENCRYPTION_KEY[ \t]*=.*$/gm;
      const next = pattern.test(contents)
        ? contents.replace(pattern, () => line)
        : `${contents}${contents && !contents.endsWith('\n') ? '\n' : ''}${line}\n`;
      await writeFile(temporary, next, { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.envPath);
    } catch {
      throw new ServiceUnavailableException(
        '无法为用户 API Key 创建加密密钥，请检查 backend/.env 的写入权限',
      );
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
