// ESM 下 jest 不注入全局对象，改用 import.meta.jest（@types/jest 已声明其类型）
const jest = import.meta.jest;

import { Character, QuestionnaireAnswers, RelationListSchema } from '@rill/shared';
import { LlmService } from '../../ai/llm.service.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { AiConfig } from '../../ai/config/ai.config.js';
import { UsageRecorder } from '../../ai/observability/usage-recorder.js';
import { PrismaService } from '../prisma.service.js';
import { ArtifactRegistry } from '../pipeline/artifact.registry.js';
import { RelationGenerator } from './relations.generator.js';
import { makeAiConfig } from '../../../test/ai-config-fixture.js';

const config: AiConfig = makeAiConfig();

const answers: QuestionnaireAnswers = {
  genre: 'xuanhuan',
  length: 'short',
  tone: '热血',
  pov: '第一人称',
};

// id 故意「倒序」：甲的 id 大于乙的 id，用于验证规范化时的交换
const dbCharacters = [
  { id: 'char-aaa', name: '乙', role: 'antagonist', data: '{}', status: 'done', stale: false },
  { id: 'char-zzz', name: '甲', role: 'protagonist', data: '{}', status: 'done', stale: false },
];

const contextCharacters: Character[] = [
  {
    name: '甲',
    role: 'protagonist',
    identity: '少年',
    desire: '复仇',
    flaw: '冲动',
    personality: '刚烈',
    background: '灭门',
    abilities: '剑术',
    arc: '成长为领袖',
  },
  {
    name: '乙',
    role: 'antagonist',
    identity: '盟主',
    desire: '霸权',
    flaw: '多疑',
    personality: '阴鸷',
    background: '篡位',
    abilities: '权谋',
    arc: '众叛亲离',
  },
];

function setup() {
  const completeStructured = jest.fn();
  const llm = { completeStructured } as unknown as LlmService;
  const prompts = new PromptRegistry();
  const usage = new UsageRecorder(config);
  const findMany = jest.fn().mockResolvedValue(dbCharacters);
  const deleteMany = jest.fn().mockResolvedValue({});
  const create = jest.fn().mockResolvedValue({});
  const transaction = jest.fn().mockResolvedValue([]);
  const projectUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    character: { findMany },
    relation: { deleteMany, create },
    project: { update: projectUpdate },
    $transaction: transaction,
  } as unknown as PrismaService;
  transaction.mockImplementation(async (write: unknown) =>
    (write as (tx: PrismaService) => Promise<void>)(prisma),
  );
  prisma.$transaction = transaction;

  const artifacts = new ArtifactRegistry();
  const generator = new RelationGenerator(llm, prompts, usage, prisma, artifacts);

  return { generator, completeStructured, findMany, create, transaction, artifacts };
}

describe('RelationGenerator', () => {
  it('声明阶段与上游依赖', () => {
    const { generator } = setup();
    expect(generator.stage).toBe('relations');
    expect(generator.requires()).toEqual(['characters']);
  });

  it('注册 relations 失效操作与生成器', () => {
    const { generator, artifacts } = setup();
    expect(artifacts.has('relations')).toBe(true);
    expect(artifacts.getGenerator('relations')).toBe(generator);
  });

  it('规范化：按 id 排序且交换方向角色', async () => {
    const { generator, completeStructured, create } = setup();
    // 模型以「甲 → 乙」描述，但甲的 id 更大，应被交换
    completeStructured.mockResolvedValue({
      relations: [
        {
          fromName: '甲',
          toName: '乙',
          type: '仇敌',
          fromRole: '复仇者',
          toRole: '灭门仇人',
          description: '灭门之仇',
        },
      ],
    });

    await generator.generate({ characters: contextCharacters }, answers, 'p1');

    const row = create.mock.calls[0][0].data;
    expect(row.fromId).toBe('char-aaa');
    expect(row.toId).toBe('char-zzz');
    expect(row.fromRole).toBe('灭门仇人');
    expect(row.toRole).toBe('复仇者');
  });

  it('同一对人物只存一条关系，描述合并不丢弃', async () => {
    const { generator, completeStructured, create } = setup();
    completeStructured.mockResolvedValue({
      relations: [
        {
          fromName: '甲',
          toName: '乙',
          type: '仇敌',
          fromRole: '复仇者',
          toRole: '仇人',
          description: '灭门之仇',
        },
        {
          fromName: '乙',
          toName: '甲',
          type: '仇敌',
          fromRole: '仇人',
          toRole: '复仇者',
          description: '旧账未清',
        },
      ],
    });

    await generator.generate({ characters: contextCharacters }, answers, 'p1');

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.description).toBe('灭门之仇；旧账未清');
  });

  it('同一对人物的多重关系合并为一条并保留类型信息', async () => {
    const { generator, completeStructured, create } = setup();
    completeStructured.mockResolvedValue({
      relations: [
        {
          fromName: '甲',
          toName: '乙',
          type: '仇敌',
          fromRole: '复仇者',
          toRole: '仇人',
          description: '灭门之仇',
        },
        {
          fromName: '乙',
          toName: '甲',
          type: '利益',
          fromRole: '买主',
          toRole: '掮客',
          description: '买卖旧物',
        },
      ],
    });

    await generator.generate({ characters: contextCharacters }, answers, 'p1');

    expect(create).toHaveBeenCalledTimes(1);
    const row = create.mock.calls[0][0].data;
    // 保留先到的主关系类型，附加关系的类型以标注形式并入描述
    expect(row.type).toBe('仇敌');
    expect(row.description).toBe('灭门之仇；[利益] 买卖旧物');
  });

  it('跳过引用不存在人物的关系', async () => {
    const { generator, completeStructured, create } = setup();
    completeStructured.mockResolvedValue({
      relations: [
        {
          fromName: '甲',
          toName: '乙',
          type: '仇敌',
          fromRole: 'a',
          toRole: 'b',
          description: 'ok',
        },
        {
          fromName: '甲',
          toName: '丙',
          type: '师徒',
          fromRole: '师父',
          toRole: '徒弟',
          description: '无人物的关系',
        },
      ],
    });

    await generator.generate({ characters: contextCharacters }, answers, 'p1');

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('人物不足两个时拒绝生成', async () => {
    const { generator, findMany } = setup();
    findMany.mockResolvedValue([dbCharacters[0]]);

    await expect(
      generator.generate({ characters: contextCharacters.slice(0, 1) }, answers, 'p1'),
    ).rejects.toThrow(/至少需要两个/);
  });

  it('提示词包含已确认人物', async () => {
    const { generator, completeStructured } = setup();
    const result = { relations: [] };
    expect(RelationListSchema.safeParse(result).success).toBe(true);
    completeStructured.mockResolvedValue(result);

    await generator.generate({ characters: contextCharacters }, answers, 'p1');

    const messages = completeStructured.mock.calls[0][1] as Array<{ content: string }>;
    expect(messages[0].content).toContain('【已确认人物】');
    expect(messages[0].content).toContain('甲');
    expect(messages[0].content).toContain('一个可能改变关系的关键选择或事件');
    expect(messages[0].content).toContain('关系变化必须来自人物行动');
  });
});
