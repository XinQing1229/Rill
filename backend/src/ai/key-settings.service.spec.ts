import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseEnv } from 'dotenv';
import configuration from '../config/configuration.js';
import { parseAiConfig, type AiConfig } from './config/ai.config.js';
import { KeySettingsService } from './key-settings.service.js';
import { ApiKeyUpdateSchema } from '@rill/shared';

describe('Web API Key 设置', () => {
  let directory: string;
  let path: string;
  let config: AiConfig;
  let service: KeySettingsService;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'rill-key-settings-'));
    path = join(directory, '.env');
    config = parseAiConfig(configuration().llm);
    config.apiKey = 'old-key';
    service = new KeySettingsService(config, path);
  });
  afterEach(async () => {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    await rm(directory, { recursive: true, force: true });
  });
  it('查询不回显密钥，保存保留其他环境配置且立即生效、重启可读取', async () => {
    await writeFile(path, '# 用户配置\nPORT=3000\nDEEPSEEK_API_KEY="old-key"\n');
    expect(JSON.stringify(service.state())).not.toContain('old-key');
    const result = await service.update({ action: 'replace', apiKey: 'sk-new-test-key' });
    expect(result.hasApiKey).toBe(true);
    expect(JSON.stringify(result)).not.toContain('sk-new-test-key');
    expect(config.apiKey).toBe('sk-new-test-key');
    const contents = await readFile(path, 'utf8');
    expect(contents).toContain('# 用户配置\nPORT=3000');
    expect(parseEnv(contents).DEEPSEEK_API_KEY).toBe('sk-new-test-key');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
  it('清除持久化空密钥且不删除其他设置', async () => {
    await writeFile(path, 'PORT=3000\n');
    expect((await service.update({ action: 'remove' })).hasApiKey).toBe(false);
    expect(parseEnv(await readFile(path, 'utf8'))).toEqual({ PORT: '3000', DEEPSEEK_API_KEY: '' });
    expect(config.apiKey).toBe('');
  });
  it('写失败不改变已生效密钥且不泄露输入', async () => {
    service = new KeySettingsService(config, join(directory, 'missing', '.env'));
    await expect(service.update({ action: 'replace', apiKey: 'sk-do-not-leak' })).rejects.toThrow(
      'API Key 保存失败',
    );
    expect(config.apiKey).toBe('old-key');
  });
  it('拒绝换行注入、空密钥和意外字段', () => {
    for (const apiKey of ['', 'sk-key\nPORT=1', 'sk-key"']) {
      expect(ApiKeyUpdateSchema.safeParse({ action: 'replace', apiKey }).success).toBe(false);
    }
    expect(ApiKeyUpdateSchema.safeParse({ action: 'remove', apiKey: 'unused' }).success).toBe(
      false,
    );
  });
  it('并发保存拒绝第二个请求，不交错更新文件和内存', async () => {
    const first = service.update({ action: 'replace', apiKey: 'sk-first' });
    await expect(service.update({ action: 'replace', apiKey: 'sk-second' })).rejects.toThrow(
      '正在保存配置',
    );
    await first;
    expect(config.apiKey).toBe('sk-first');
  });
});
