const jest = import.meta.jest;
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmController } from '../src/llm/llm.controller.js';
import { LlmService } from '../src/ai/llm.service.js';
import { KeySettingsService } from '../src/ai/key-settings.service.js';
import { parseAiConfig } from '../src/ai/config/ai.config.js';
import configuration from '../src/config/configuration.js';

describe('API Key 设置 HTTP', () => {
  let app: INestApplication;
  let directory: string;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const complete = jest.fn();
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'rill-key-http-'));
    const config = parseAiConfig(configuration().llm);
    config.apiKey = '';
    const moduleRef = await Test.createTestingModule({
      controllers: [LlmController],
      providers: [
        {
          provide: KeySettingsService,
          useValue: new KeySettingsService(config, join(directory, '.env')),
        },
        { provide: LlmService, useValue: { complete, hasApiKey: () => true } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  });
  it('保存和查询只返回脱敏状态，不调用模型', async () => {
    const saved = await request(app.getHttpServer())
      .post('/api/llm/settings')
      .set('Host', 'localhost:3000')
      .set('Origin', 'http://localhost:5173')
      .send({ action: 'replace', apiKey: 'sk-http-test' })
      .expect(201);
    expect(saved.body.hasApiKey).toBe(true);
    expect(JSON.stringify(saved.body)).not.toContain('sk-http-test');
    const queried = await request(app.getHttpServer()).get('/api/llm/settings').expect(200);
    expect(queried.headers['cache-control']).toBe('no-store');
    expect(queried.body).not.toHaveProperty('apiKey');
    expect(complete).not.toHaveBeenCalled();
  });
  it('拒绝跨站修改和非法输入', async () => {
    await request(app.getHttpServer())
      .post('/api/llm/settings')
      .set('Host', 'localhost:3000')
      .set('Origin', 'https://other.example')
      .send({ action: 'remove' })
      .expect(403);
    const invalid = await request(app.getHttpServer())
      .post('/api/llm/settings')
      .send({ action: 'replace', apiKey: 'sk-secret\nINJECT=1' })
      .expect(400);
    expect(JSON.stringify(invalid.body)).not.toContain('sk-secret');
  });
  it('连接测试认证失败不会把供应商异常中的密钥写入响应或日志', async () => {
    complete.mockRejectedValueOnce(
      Object.assign(new Error('sk-private-provider-error'), { status: 401 }),
    );
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app.getHttpServer()).post('/api/llm/ping').expect(502);
      expect(JSON.stringify(response.body)).not.toContain('sk-private-provider-error');
      expect(response.body.message).toContain('认证失败');
      expect(JSON.stringify(log.mock.calls)).not.toContain('sk-private-provider-error');
    } finally {
      log.mockRestore();
    }
  });
});
