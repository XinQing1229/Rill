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

describe('UsageRecorder', () => {
  it('多次调用的用量按 traceId 聚合为一条记录', () => {
    const recorder = new UsageRecorder(baseConfig);
    const traceId = 'trace-1';

    recorder.callbacks(traceId, 'deepseek-flash').handleLLMEnd({
      llmOutput: { tokenUsage: { promptTokens: 10, completionTokens: 5 } },
    });
    recorder.callbacks(traceId, 'deepseek-flash').handleLLMEnd({
      llmOutput: { tokenUsage: { promptTokens: 20, completionTokens: 7 } },
    });

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
    recorder.callbacks('trace-4', 'deepseek-flash').handleLLMEnd({
      llmOutput: { tokenUsage: { promptTokens: 100, completionTokens: 50 } },
    });
    expect(recorder.get('trace-4')?.estimatedCost).toBeNull();
  });

  it('配置单价后估算费用', () => {
    const recorder = new UsageRecorder({
      ...baseConfig,
      pricing: { inputPerMTokens: 2, outputPerMTokens: 8 },
    });
    recorder.callbacks('trace-5', 'deepseek-flash').handleLLMEnd({
      llmOutput: { tokenUsage: { promptTokens: 1_000_000, completionTokens: 1_000_000 } },
    });
    expect(recorder.get('trace-5')?.estimatedCost).toBe(10);
  });
});
