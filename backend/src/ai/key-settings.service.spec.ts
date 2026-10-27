const jest = import.meta.jest;

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { ApiKeyUpdateSchema } from '@rill/shared';
import { makeAiConfig } from '../../test/ai-config-fixture.js';
import { KeySettingsService } from './key-settings.service.js';

describe('模型设置与 API Key 解析', () => {
  let directory: string;
  let envPath: string;
  let stored: Record<string, unknown> | null;
  let service: KeySettingsService;
  let config: ReturnType<typeof makeAiConfig>;
  const previousEncryptionKey = process.env.LLM_CREDENTIAL_ENCRYPTION_KEY;

  function createService() {
    stored = null;
    const prisma = {
      aiSettings: {
        findUnique: jest.fn(async () => stored),
        upsert: jest.fn(async ({ create, update }: { create: object; update: object }) => {
          stored = stored ? { ...stored, ...update } : { ...create };
          return stored;
        }),
      },
    };
    service = new KeySettingsService(config, envPath, prisma as never);
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'rill-model-settings-'));
    envPath = join(directory, '.env');
    config = makeAiConfig();
    createService();
    await service.onModuleInit();
  });

  afterEach(async () => {
    if (previousEncryptionKey === undefined) delete process.env.LLM_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.LLM_CREDENTIAL_ENCRYPTION_KEY = previousEncryptionKey;
    await rm(directory, { recursive: true, force: true });
  });

  it('用户 Key 加密保存，不进入环境文件或查询结果', async () => {
    const apiKey = 'glm.user-key-123';
    const result = await service.update({ action: 'replace-key', provider: 'glm', apiKey });

    expect(result.providers.glm.keySource).toBe('user');
    expect(service.active().provider).toBe('deepseek');
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(apiKey);
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(await readFile(envPath, 'utf8')).not.toContain(apiKey);
  });

  it('优先使用用户设置 Key，缺省时使用同服务商环境 Key', async () => {
    config.providers.deepseek.apiKey = 'deepseek-env-key';
    createService();
    await service.onModuleInit();
    expect(service.state().providers.deepseek.keySource).toBe('env');
    expect(service.active().apiKey).toBe('deepseek-env-key');

    await service.update({
      action: 'replace-key',
      provider: 'deepseek',
      apiKey: 'deepseek-user-key',
    });
    expect(service.active().apiKey).toBe('deepseek-user-key');
  });

  it('清除用户 Key 后回退到同服务商环境 Key，并保存模型选择', async () => {
    config.providers.glm.apiKey = 'glm-env-key';
    createService();
    await service.onModuleInit();
    await service.update({ action: 'replace-key', provider: 'glm', apiKey: 'glm-user-key' });
    await service.update({ action: 'select-model', provider: 'glm', model: 'glm-5.3' });
    expect(service.active().apiKey).toBe('glm-user-key');

    const result = await service.update({ action: 'remove-key', provider: 'glm' });
    expect(result.activeProvider).toBe('glm');
    expect(result.providers.glm.keySource).toBe('env');
    expect(service.active().apiKey).toBe('glm-env-key');
  });

  it('当前服务商的两处都没有 Key 时才拒绝调用', () => {
    config.providers.deepseek.apiKey = '';
    expect(() => service.active()).toThrow(ServiceUnavailableException);
    expect(() => service.active()).toThrow(/未配置DeepSeek API Key/);
  });

  it('拒绝不受支持的模型和 API Key 格式', async () => {
    await expect(
      service.update({ action: 'select-model', provider: 'glm', model: 'unknown' }),
    ).rejects.toThrow('当前不可用');
    for (const apiKey of ['', 'key\nINJECT=1', 'key"with-quote']) {
      expect(
        ApiKeyUpdateSchema.safeParse({ action: 'replace-key', provider: 'glm', apiKey }).success,
      ).toBe(false);
    }
  });
});
