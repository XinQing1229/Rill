import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

const mockCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import OpenAI from 'openai';

describe('LlmService', () => {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        'llm.baseUrl': 'https://api.deepseek.com',
        'llm.apiKey': 'test-key',
        'llm.model': 'deepseek-flash',
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('使用配置中的 baseUrl 与 apiKey 构造客户端', () => {
    new LlmService(config);
    expect(OpenAI).toHaveBeenCalledWith({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'test-key',
    });
  });

  it('complete 使用配置中的默认模型并返回归一化结果', async () => {
    mockCreate.mockResolvedValue({
      model: 'deepseek-flash',
      choices: [{ message: { content: '收到' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });

    const service = new LlmService(config);
    const result = await service.complete([{ role: 'user', content: 'hi' }], { maxTokens: 64 });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'deepseek-flash', max_tokens: 64 }),
    );
    expect(result).toEqual({
      model: 'deepseek-flash',
      content: '收到',
      reasoning: undefined,
      usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
    });
  });

  it('thinking 开启时传递 thinking 参数', async () => {
    mockCreate.mockResolvedValue({ model: 'm', choices: [{ message: { content: '' } }] });

    const service = new LlmService(config);
    await service.complete([{ role: 'user', content: 'hi' }], { thinking: true });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ thinking: { type: 'enabled' } }),
    );
  });

  it('stream 为预留方法，迭代时报错', async () => {
    const service = new LlmService(config);
    await expect(service.stream([]).next()).rejects.toThrow('尚未实现');
  });
});
