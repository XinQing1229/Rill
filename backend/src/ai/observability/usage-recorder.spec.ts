import { AiConfig } from '../config/ai.config';
import { UsageRecorder } from './usage-recorder';

const baseConfig: AiConfig = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'secret-key-value',
  usages: {
    draft: {
      model: 'deepseek-flash',
      temperature: 0.9,
      maxTokens: 2048,
      timeout: 60_000,
      thinking: false,
    },
    reasoning: {
      model: 'deepseek-flash',
      temperature: 0.3,
      maxTokens: 4096,
      timeout: 120_000,
      thinking: true,
    },
  },
  retry: { maxAttempts: 3, initialInterval: 10, backoffFactor: 1, maxInterval: 20, jitter: false },
  structured: { maxRepairAttempts: 2 },
  budget: { maxCallsPerRequest: 6 },
  pricing: { inputPerMTokens: null, outputPerMTokens: null },
};

function end(recorder: UsageRecorder, traceId: string, prompt = 10, completion = 5): void {
  recorder.callbacks(traceId, 'deepseek-flash').handleLLMEnd({
    llmOutput: { tokenUsage: { promptTokens: prompt, completionTokens: completion } },
  });
}

describe('UsageRecorder', () => {
  it('多次调用的用量按 traceId 聚合为一条记录', () => {
    const recorder = new UsageRecorder(baseConfig);
    const traceId = 'trace-1';

    end(recorder, traceId, 10, 5);
    end(recorder, traceId, 20, 7);

    const record = recorder.get(traceId);
    expect(record?.calls).toBe(2);
    expect(record?.promptTokens).toBe(30);
    expect(record?.completionTokens).toBe(12);
    expect(record?.totalTokens).toBe(42);
  });

  it('支持 usage_metadata 形式的用量', () => {
    const recorder = new UsageRecorder(baseConfig);
    recorder.callbacks('trace-2', 'deepseek-flash').handleLLMEnd({
      generations: [[{ message: { usage_metadata: { input_tokens: 8, output_tokens: 3 } } }]],
    });
    expect(recorder.get('trace-2')?.totalTokens).toBe(11);
  });

  it('调用失败也计入次数', () => {
    const recorder = new UsageRecorder(baseConfig);
    recorder.callbacks('trace-3', 'deepseek-flash').handleLLMError();
    expect(recorder.get('trace-3')?.calls).toBe(1);
  });

  it('未配置单价时费用为 null', () => {
    const recorder = new UsageRecorder(baseConfig);
    end(recorder, 'trace-4', 100, 50);
    expect(recorder.get('trace-4')?.estimatedCost).toBeNull();
  });

  it('配置单价后估算费用', () => {
    const recorder = new UsageRecorder({
      ...baseConfig,
      pricing: { inputPerMTokens: 2, outputPerMTokens: 8 },
    });
    end(recorder, 'trace-5', 1_000_000, 1_000_000);
    expect(recorder.get('trace-5')?.estimatedCost).toBe(10);
  });

  it('过期记录被清理，防止内存无限增长', () => {
    const recorder = new UsageRecorder(baseConfig);
    end(recorder, 'old-trace');

    // 篡改最近访问时间，模拟记录已过期
    const record = recorder.get('old-trace');
    expect(record).toBeDefined();
    record!.lastTouchedAt = Date.now() - 31 * 60 * 1000;

    // 任意一次读写都会触发清理
    end(recorder, 'fresh-trace');

    expect(recorder.get('old-trace')).toBeUndefined();
    expect(recorder.get('fresh-trace')).toBeDefined();
  });

  it('读取会为记录续期，避免使用中的记录被清掉', () => {
    const recorder = new UsageRecorder(baseConfig);
    end(recorder, 'active-trace');

    const first = recorder.get('active-trace');
    first!.lastTouchedAt = Date.now() - 29 * 60 * 1000;

    // 生成器可能在生成结束后才来取用量：读取应续期
    expect(recorder.get('active-trace')).toBeDefined();
    expect(recorder.get('active-trace')).toBeDefined();
  });

  it('超出容量上限时淘汰最旧的记录', () => {
    const recorder = new UsageRecorder(baseConfig);
    for (let index = 0; index < 1005; index += 1) {
      end(recorder, `bulk-${index}`);
    }

    expect(recorder.get('bulk-0')).toBeUndefined();
    expect(recorder.get('bulk-1004')).toBeDefined();
  });
});
