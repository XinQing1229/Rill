// ESM 下 jest 不注入全局对象，改用 import.meta.jest（@types/jest 已声明其类型）
const jest = import.meta.jest;

import { CharacterListSchema, Premise, QuestionnaireAnswers } from '@rill/shared';
import { LlmService } from '../../ai/llm.service.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { AiConfig } from '../../ai/config/ai.config.js';
import { UsageRecorder } from '../../ai/observability/usage-recorder.js';
import { PrismaService } from '../prisma.service.js';
import { ArtifactRegistry } from '../pipeline/artifact.registry.js';
import { CharacterGenerator } from './characters.generator.js';
import { makeAiConfig } from '../../../test/ai-config-fixture.js';

const config: AiConfig = makeAiConfig();

const answers: QuestionnaireAnswers = {
  genre: 'xuanhuan',
  length: 'short',
  tone: '热血',
  pov: '第一人称',
};

const premise: Premise = {
  title: '临安十二时',
  logline: '南宋临安，被革职的仵作与女说书人联手破案。',
  theme: '真相与偏见',
  coreConflict: '市井仵作与权贵之间的真相之争',
  protagonist: { name: '沈砚', identity: '被革职的仵作', desire: '重查旧案', flaw: '过度执拗' },
  setting: { era: '南宋', place: '临安城', socialBackground: '市井繁华' },
  hook: '闹鬼命案',
  taboos: [],
};

function setup() {
  const completeStructured = jest.fn();
  const llm = { completeStructured } as unknown as LlmService;
  const prompts = new PromptRegistry();
  const usage = new UsageRecorder(config);
  const deleteMany = jest.fn().mockResolvedValue({});
  const create = jest.fn().mockResolvedValue({});
  const projectUpdate = jest.fn().mockResolvedValue({});
  const transaction = jest.fn().mockResolvedValue([]);
  const prisma = {
    character: { deleteMany, create },
    project: { update: projectUpdate },
    $transaction: transaction,
  } as unknown as PrismaService;
  transaction.mockImplementation(async (write: unknown) =>
    (write as (tx: PrismaService) => Promise<void>)(prisma),
  );
  prisma.$transaction = transaction;

  const artifacts = new ArtifactRegistry();
  const generator = new CharacterGenerator(llm, prompts, usage, prisma, artifacts);

  return { generator, completeStructured, deleteMany, create, transaction, artifacts };
}

function makeCharacters(count: number, withProtagonist = true) {
  return {
    characters: Array.from({ length: count }, (_, index) => ({
      name: `人物${index + 1}`,
      role: withProtagonist && index === 0 ? 'protagonist' : 'supporting',
      identity: `身份${index + 1}`,
      desire: '想要',
      flaw: '软肋',
      personality: '性格',
      background: '背景',
      abilities: '能力',
      arc: '弧光',
    })),
  };
}

describe('CharacterGenerator', () => {
  it('上游依赖按类型动态声明', () => {
    const { generator } = setup();
    expect(generator.requires(answers)).toEqual(['premise', 'world']);
    // 跳过世界观的类型不依赖 world
    expect(generator.requires({ ...answers, genre: 'dushi' })).toEqual(['premise']);
  });

  it('注册 characters 失效操作与生成器（关系联动）', () => {
    const { generator, artifacts } = setup();
    expect(artifacts.has('characters')).toBe(true);
    expect(artifacts.getGenerator('characters')).toBe(generator);
    expect(generator.stage).toBe('characters');
  });

  it('按篇幅配置的默认人数生成', async () => {
    const { generator, completeStructured, create, transaction } = setup();
    const result = makeCharacters(4);
    expect(CharacterListSchema.safeParse(result).success).toBe(true);
    completeStructured.mockResolvedValue(result);

    await generator.generate({ premise }, answers, 'p1');

    expect(transaction).toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(4);
    const messages = completeStructured.mock.calls[0][1] as Array<{ content: string }>;
    expect(messages[0].content).toContain('4 个人物');
    expect(messages[0].content).toContain('background 写与当前故事有关的经历或重要隐瞒');
    expect(messages[0].content).toContain('至少一个关键人物的目标');
  });

  it('问卷人物数量选答覆盖默认人数', async () => {
    const { generator, completeStructured, create } = setup();
    completeStructured.mockResolvedValue(makeCharacters(6));

    await generator.generate({ premise }, { ...answers, extras: { characterScale: 'rich' } }, 'p1');

    expect(create).toHaveBeenCalledTimes(6);
    const messages = completeStructured.mock.calls[0][1] as Array<{ content: string }>;
    expect(messages[0].content).toContain('6 个人物');
  });

  it('模型未标注主角时把第一个人物提升为主角', async () => {
    const { generator, completeStructured, create } = setup();
    completeStructured.mockResolvedValue(makeCharacters(3, false));

    await generator.generate({ premise }, answers, 'p1');

    const first = create.mock.calls[0][0].data;
    expect(first.role).toBe('protagonist');
  });

  it('无世界观产物时以降级上下文正常生成', async () => {
    const { generator, completeStructured, create } = setup();
    completeStructured.mockResolvedValue(makeCharacters(3));

    await generator.generate({ premise }, { ...answers, genre: 'dushi' }, 'p1');

    expect(create).toHaveBeenCalledTimes(3);
    const messages = completeStructured.mock.calls[0][1] as Array<{ content: string }>;
    expect(messages[0].content).not.toContain('【世界观】');
  });

  it('生成结果为空时报错', async () => {
    const { generator, completeStructured } = setup();
    completeStructured.mockResolvedValue({ characters: [] });

    await expect(generator.generate({ premise }, answers, 'p1')).rejects.toThrow(/为空/);
  });
});
