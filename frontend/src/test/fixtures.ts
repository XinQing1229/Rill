import type {
  CharacterRow,
  Premise,
  PremiseArtifact,
  ProjectDetail,
  ProjectSummary,
  QuestionnaireDefinition,
  RelationRow,
  WorldArtifact,
} from '@rill/shared';

export const premiseData: Premise = {
  title: '青川令',
  logline: '守碑人少女与碑中古战魂同行北上，修复断裂的边境碑阵。',
  theme: '记忆与代价',
  coreConflict: '修复碑阵需要以战魂的记忆为薪',
  protagonist: {
    name: '沈青偃',
    identity: '守碑人',
    desire: '修复碑阵，让亡兄的名字重刻于碑',
    flaw: '不敢承认哥哥的死与自己有关',
  },
  setting: { era: '大凛王朝末年', place: '北境青川关', socialBackground: '边军制与碑祀制并存' },
  hook: '第一面碑裂开时，飞出的是一封三十年前的家书',
  taboos: ['不写失忆梗循环', '避免苦情告白'],
};

export const worldData = {
  summary: '大凛北境以碑阵锁魂御敌。',
  rules: [{ name: '碑祀之律', description: '战死者名入碑，魂守关。' }],
  factions: [{ name: '守碑司', nature: '掌碑衙司', stance: '守着规矩吃饭' }],
  powerSystem: { realms: ['铭魂境', '刻名境'], resources: '记忆', cost: '燃一段记忆换一阵效力' },
};

export const characterData = {
  name: '沈青偃',
  role: 'protagonist',
  identity: '守碑人',
  desire: '修复碑阵',
  flaw: '不敢承认',
  personality: '沉静执拗',
  background: '守碑司旁支孤女',
  abilities: '辨魂、铭名',
  arc: '从求兄归到让兄安息',
};

export function makeArtifactBase(overrides: Partial<PremiseArtifact> = {}) {
  return {
    id: 'art_1',
    projectId: 'prj_1',
    status: 'done' as const,
    stale: false,
    promptTokens: 1000,
    completionTokens: 800,
    error: null,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:01:00.000Z',
    ...overrides,
  };
}

export function makePremiseRow(overrides: Partial<PremiseArtifact> = {}): PremiseArtifact {
  return { ...makeArtifactBase(overrides), data: JSON.stringify(premiseData) };
}

export function makeWorldRow(overrides: Partial<WorldArtifact> = {}): WorldArtifact {
  return { ...makeArtifactBase({ id: 'world_1' }), data: JSON.stringify(worldData), ...overrides };
}

export function makeCharacterRow(
  name: string,
  role: string,
  overrides: Partial<CharacterRow> = {},
): CharacterRow {
  return {
    ...makeArtifactBase({ id: `char_${name}` }),
    name,
    role,
    data: JSON.stringify({ ...characterData, name, role }),
    ...overrides,
  };
}

export function makeRelationRow(
  fromId: string,
  toId: string,
  overrides: Partial<RelationRow> = {},
): RelationRow {
  return {
    ...makeArtifactBase({ id: `rel_${fromId}_${toId}` }),
    fromId,
    toId,
    type: '同行 · 契约',
    fromRole: '守碑人',
    toRole: '碑中战魂',
    description: '为修复碑阵同行',
    ...overrides,
  };
}

const stageList: ProjectDetail['stages'] = [
  'premise',
  'world',
  'characters',
  'relations',
  'outline',
  'beats',
  'prose',
];

export function makeProject(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'prj_1',
    title: '青川令',
    genre: 'xuanhuan',
    length: 'medium',
    mode: 'manual',
    currentStage: 'premise',
    status: 'idle',
    stages: stageList,
    answers: JSON.stringify({
      genre: 'xuanhuan',
      length: 'medium',
      tone: '厚重',
      pov: '第三人称限知',
    }),
    questionnaireVersion: 'v1',
    promptTokens: 0,
    completionTokens: 0,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T10:01:00.000Z',
    premise: makePremiseRow({ status: 'pending', data: '{}' }),
    world: null,
    characters: [],
    relations: [],
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'prj_1',
    title: '青川令',
    genre: 'xuanhuan',
    length: 'medium',
    mode: 'manual',
    currentStage: 'premise',
    status: 'idle',
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T10:01:00.000Z',
    ...overrides,
  };
}

export const questionnaireFixture: QuestionnaireDefinition = {
  version: 'v1',
  questions: [
    {
      key: 'length',
      label: '篇幅',
      required: true,
      options: [
        { value: 'short', label: '短篇' },
        { value: 'medium', label: '中篇' },
        { value: 'long', label: '长篇' },
      ],
    },
    {
      key: 'tone',
      label: '基调',
      required: true,
      options: [
        { value: '热血', label: '热血' },
        { value: '厚重', label: '厚重' },
      ],
    },
    {
      key: 'pov',
      label: '叙事视角',
      required: true,
      options: [
        { value: '第一人称', label: '第一人称' },
        { value: '第三人称限知', label: '第三人称限知' },
      ],
    },
    {
      key: 'extras.characterScale',
      label: '人物数量',
      required: false,
      options: [
        { value: 'compact', label: '少量' },
        { value: 'standard', label: '适中' },
        { value: 'rich', label: '较多' },
      ],
    },
    {
      key: 'extras.goldenFinger',
      label: '金手指类型',
      required: false,
      options: [
        { value: '天赋', label: '天赋' },
        { value: '系统', label: '系统' },
      ],
    },
  ],
};
