// ESM 下 jest 不注入全局对象，改用 import.meta.jest（@types/jest 已声明其类型）
const jest = import.meta.jest;

import { Premise } from '@rill/shared';
import { LlmService } from '../../ai/llm.service.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { AiConfig } from '../../ai/config/ai.config.js';
import { UsageRecorder } from '../../ai/observability/usage-recorder.js';
import { PrismaService } from '../prisma.service.js';
import { ArtifactRegistry } from '../pipeline/artifact.registry.js';
import { WorldGenerator } from './world.generator.js';

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

const premise: Premise = {
  title: '临安雪夜验尸录',
  logline: '仵作之女为父洗冤。',
  theme: '真相与偏见',
  coreConflict: '市井与权贵',
  protagonist: { name: '沈砚秋', identity: '仵作之女', desire: '救父', flaw: '执拗' },
  setting: { era: '南宋宁宗年间', place: '临安城', socialBackground: '市井繁华' },
  hook: '闹鬼命案',
  taboos: [],
};

function setup() {
  const completeStructured = jest.fn();
  const llm = { completeStructured } as unknown as LlmService;
  const prompts = new PromptRegistry();
  const usage = new UsageRecorder(config);
  const upsert = jest.fn().mockResolvedValue({});
  const projectUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    worldSetting: { upsert },
    project: { update: projectUpdate },
  } as unknown as PrismaService;
  prisma.$transaction = jest.fn(async (write: unknown) =>
    (write as (tx: PrismaService) => Promise<void>)(prisma),
  ) as unknown as PrismaService['$transaction'];
  const artifacts = new ArtifactRegistry();
  const generator = new WorldGenerator(llm, prompts, usage, prisma, artifacts);

  return { generator, completeStructured, upsert, usage, prompts, artifacts };
}

const generatedDetailed = {
  summary: '南宋临安的暗流',
  rules: [{ name: '验尸规制', description: '仵作不得接触权贵案件' }],
  factions: [{ name: '临安府衙', nature: '官府', stance: '维稳' }],
  geography: [{ name: '御街', description: '城中最繁华的街道' }],
  history: [{ name: '嘉定和议', description: '二十年前的旧案背景' }],
  secrets: [{ name: '御街下的密室', relatedTo: '府衙' }],
};

describe('WorldGenerator', () => {
  it('声明阶段与上游依赖', () => {
    const { generator } = setup();
    expect(generator.stage).toBe('world');
    expect(generator.requires()).toEqual(['premise']);
  });

  it('注册 world 模板、失效操作与生成器', () => {
    const { generator, prompts, artifacts } = setup();
    expect(artifacts.has('world')).toBe(true);
    expect(artifacts.getGenerator('world')).toBe(generator);
    expect(() =>
      prompts.render('world', 'v2', {
        upstream: '【种子设定】',
        genre: '玄幻',
        genreTraits: '设定自洽',
        tone: '厚重',
        tier: 'detailed',
      }),
    ).not.toThrow();
  });

  it('不同详略档位均要求设定制造剧情压力或机会', () => {
    const { prompts } = setup();
    const base = {
      upstream: '【种子设定】',
      genre: '玄幻',
      genreTraits: '设定自洽',
      tone: '厚重',
    };
    const light = prompts.render('world', 'v2', { ...base, tier: 'light' });
    const detailed = prompts.render('world', 'v2', { ...base, tier: 'detailed' });

    for (const prompt of [light, detailed]) {
      expect(prompt).toContain('限制、代价、压力或可利用的机会');
      expect(prompt).toContain('不要只罗列背景知识');
    }
    expect(light).toContain('只需产出');
    expect(detailed).toContain('完整产出');
  });

  it('时代与地点从种子继承，不由模型生成', async () => {
    const { generator, completeStructured, upsert, usage } = setup();
    completeStructured.mockImplementation(
      async (_schema: unknown, _messages: unknown, options?: { traceId?: string }) => {
        // 用生成器实际生成的 traceId 记录用量
        usage.callbacks(options?.traceId ?? '', 'deepseek-flash').handleLLMEnd({
          llmOutput: { tokenUsage: { promptTokens: 300, completionTokens: 200 } },
        });
        return generatedDetailed;
      },
    );

    await generator.generate(
      { premise },
      { genre: 'lishi', length: 'short', tone: '厚重', pov: '第一人称' },
      'p1',
    );

    const written = JSON.parse(upsert.mock.calls[0][0].create.data);
    expect(written.era).toBe('南宋宁宗年间');
    expect(written.place).toBe('临安城');
    expect(upsert.mock.calls[0][0].create.promptTokens).toBe(300);
  });

  it('详档类型产出完整块', async () => {
    const { generator, completeStructured, upsert } = setup();
    completeStructured.mockResolvedValue(generatedDetailed);

    await generator.generate(
      { premise },
      { genre: 'lishi', length: 'short', tone: '厚重', pov: '第一人称' },
      'p1',
    );

    const written = JSON.parse(upsert.mock.calls[0][0].create.data);
    expect(written.geography).toBeDefined();
    expect(written.history).toBeDefined();
    expect(written.secrets).toBeDefined();
  });

  it('简档类型裁剪掉地理、历史与秘密', async () => {
    const { generator, completeStructured, upsert } = setup();
    completeStructured.mockResolvedValue(generatedDetailed);

    await generator.generate(
      { premise },
      { genre: 'xuanyi', length: 'short', tone: '紧张', pov: '第一人称' },
      'p1',
    );

    const written = JSON.parse(upsert.mock.calls[0][0].create.data);
    expect(written.rules).toBeDefined();
    expect(written.factions).toBeDefined();
    expect(written.geography).toBeUndefined();
    expect(written.history).toBeUndefined();
    expect(written.secrets).toBeUndefined();
  });

  it('最简档类型直接拒绝生成', async () => {
    const { generator, completeStructured } = setup();
    await expect(
      generator.generate(
        { premise },
        { genre: 'dushi', length: 'short', tone: '轻松', pov: '第一人称' },
        'p1',
      ),
    ).rejects.toThrow(/不生成世界观阶段/);
    expect(completeStructured).not.toHaveBeenCalled();
  });
});
