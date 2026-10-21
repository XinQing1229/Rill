import { Premise, QuestionnaireAnswers } from '@rill/shared';
import { LlmService } from '../../ai/llm.service';
import { PromptRegistry } from '../../ai/prompts/prompt.registry';
import { AiConfig } from '../../ai/config/ai.config';
import { UsageRecorder } from '../../ai/observability/usage-recorder';
import { PrismaService } from '../prisma.service';
import { ArtifactRegistry } from '../pipeline/artifact.registry';
import { PremiseGenerator } from './premise.generator';

const config: AiConfig = {
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

const sample: Premise = {
  title: '临安十二时',
  logline: '南宋临安，被革职的仵作与女说书人联手破案。',
  theme: '真相与偏见',
  coreConflict: '市井仵作与权贵之间的真相之争',
  protagonist: {
    name: '沈砚',
    identity: '被革职的仵作',
    desire: '重查二十年前的旧案',
    flaw: '过度执拗，不擅自保',
  },
  setting: { era: '南宋', place: '临安城', socialBackground: '市井繁华、权贵倾轧' },
  hook: '每桩"闹鬼"命案背后都是人为布局',
  taboos: ['血腥描写'],
};

const answers: QuestionnaireAnswers = {
  genre: 'xuanyi',
  length: 'short',
  tone: '紧张',
  pov: '第三人称限知',
  idea: '南宋临安推理',
};

function setup() {
  const completeStructured = jest.fn();
  const llm = { completeStructured } as unknown as LlmService;
  const prompts = new PromptRegistry();
  const usage = new UsageRecorder(config);
  const premiseUpdate = jest.fn().mockResolvedValue({});
  const projectUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    premise: { update: premiseUpdate },
    project: { update: projectUpdate },
  } as unknown as PrismaService;
  const artifacts = new ArtifactRegistry();
  const generator = new PremiseGenerator(llm, prompts, usage, prisma, artifacts);

  return { generator, completeStructured, premiseUpdate, projectUpdate, usage, prompts, artifacts };
}

describe('PremiseGenerator', () => {
  it('声明阶段与上游依赖（无上游）', () => {
    const { generator } = setup();
    expect(generator.stage).toBe('premise');
    expect(generator.requires()).toEqual([]);
  });

  it('注册种子模板与 premise 失效操作', () => {
    const { generator, prompts, artifacts } = setup();
    expect(artifacts.has('premise')).toBe(true);
    expect(artifacts.getGenerator('premise')).toBe(generator);
    expect(() =>
      prompts.render('premise', 'v1', {
        genre: '悬疑',
        genreTraits: '线索递进',
        tone: '紧张',
        pov: '第三人称限知',
        length: '短篇',
      }),
    ).not.toThrow();
  });

  it('生成成功时写入产物数据并记录用量', async () => {
    const { generator, completeStructured, premiseUpdate, usage } = setup();
    let capturedTraceId = '';
    completeStructured.mockImplementation(
      async (_schema, _messages, options?: { traceId?: string }) => {
        capturedTraceId = options?.traceId ?? '';
        usage.callbacks(capturedTraceId, 'deepseek-flash').handleLLMEnd({
          llmOutput: { tokenUsage: { promptTokens: 120, completionTokens: 80 } },
        });
        return sample;
      },
    );

    await generator.generate({}, answers, 'project-1');

    expect(premiseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project-1' },
        data: expect.objectContaining({
          stale: false,
          promptTokens: 120,
          completionTokens: 80,
        }),
      }),
    );
    expect(JSON.parse(premiseUpdate.mock.calls[0][0].data.data).title).toBe('临安十二时');
  });

  it('提示词注入问卷答案（类型、基调、视角、创意）', async () => {
    const { generator, completeStructured } = setup();
    completeStructured.mockResolvedValue(sample);

    await generator.generate({}, answers, 'project-1');

    const messages = completeStructured.mock.calls[0][1] as Array<{ content: string }>;
    const prompt = messages[0].content;
    expect(prompt).toContain('悬疑');
    expect(prompt).toContain('紧张');
    expect(prompt).toContain('第三人称限知');
    expect(prompt).toContain('南宋临安推理');
  });

  it('未提供创意时提示词改为让模型自行构思', async () => {
    const { generator, completeStructured } = setup();
    completeStructured.mockResolvedValue(sample);

    await generator.generate({}, { ...answers, idea: undefined }, 'project-2');

    const messages = completeStructured.mock.calls[0][1] as Array<{ content: string }>;
    expect(messages[0].content).toContain('自行构思');
  });

  it('生成失败时不写入产物', async () => {
    const { generator, completeStructured, premiseUpdate } = setup();
    completeStructured.mockRejectedValue(new Error('调用失败'));

    await expect(generator.generate({}, answers, 'project-1')).rejects.toThrow('调用失败');
    expect(premiseUpdate).not.toHaveBeenCalled();
  });
});
