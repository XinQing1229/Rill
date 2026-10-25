const jest = import.meta.jest;
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service.js';
import { PipelineService } from '../pipeline/pipeline.service.js';
import { ArtifactRegistry } from '../pipeline/artifact.registry.js';
import { UpstreamAssembler } from '../pipeline/upstream.assembler.js';
import { QuestionnaireService } from '../questionnaire/questionnaire.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { LlmService } from '../../ai/llm.service.js';
import { UsageRecorder } from '../../ai/observability/usage-recorder.js';
import { PremiseRevisionService } from './premise-revision.service.js';
import { premiseFixture as sample } from '../../../test/fixtures/premise.js';
import {
  PreviewPremiseBodySchema,
  PremisePreviewSchema,
  AdoptPremiseBodySchema,
} from '@rill/shared';

const directory = mkdtempSync(join(tmpdir(), 'rill-premise-unit-'));
copyFileSync(new URL('../../../pipeline-test.db', import.meta.url), join(directory, 'test.db'));
process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaService();
const artifacts = new ArtifactRegistry();
const pipeline = new PipelineService(
  prisma,
  new QuestionnaireService(),
  artifacts,
  new UpstreamAssembler(prisma, artifacts),
  new ConfigService({ pipeline: { checkpointFile: join(directory, 'cp.db') } }),
);
const completeStructured = jest.fn();
const getUsage = jest.fn();
const service = new PremiseRevisionService(
  prisma,
  { completeStructured } as unknown as LlmService,
  new PromptRegistry(),
  { get: getUsage } as unknown as UsageRecorder,
  pipeline,
);
let id: string;
const body = () => ({ requestId: randomUUID(), feedback: '加强核心冲突' });
const formal = () => prisma.premise.findUniqueOrThrow({ where: { projectId: id } });
const project = () => prisma.project.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await prisma.$connect();
  await pipeline.onModuleInit();
});
afterAll(async () => {
  pipeline.onModuleDestroy();
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  jest.restoreAllMocks();
  completeStructured.mockReset();
  getUsage.mockReset();
  completeStructured.mockResolvedValue({
    premise: { ...sample, coreConflict: '修改后的冲突' },
    changeNotes: [{ path: 'coreConflict', description: '加强核心矛盾' }],
  });
  getUsage.mockReturnValue({ promptTokens: 20, completionTokens: 10 });
  Object.assign(service, { previewTimeoutMs: 10000 });
  const created = await prisma.project.create({
    data: {
      title: '旧城来信',
      genre: 'dushi',
      length: 'short',
      currentStage: 'outline',
      answers: JSON.stringify({
        genre: 'dushi',
        length: 'short',
        tone: '温暖',
        pov: '第三人称',
        extras: { relation: '契约搭档' },
        taboos: ['血腥'],
      }),
      premise: { create: { data: JSON.stringify(sample), status: 'done', promptTokens: 100 } },
    },
  });
  id = created.id;
});

it('契约验证请求身份、空建议、长度和完整候选', () => {
  expect(PreviewPremiseBodySchema.parse({ ...body(), feedback: ' 建议 ' }).feedback).toBe('建议');
  for (const invalid of [
    { ...body(), requestId: 'bad' },
    { ...body(), feedback: '   ' },
    { ...body(), feedback: '字'.repeat(2001) },
  ]) {
    expect(PreviewPremiseBodySchema.safeParse(invalid).success).toBe(false);
  }
  expect(PremisePreviewSchema.safeParse({ candidateId: 'c', premise: sample }).success).toBe(true);
  expect(PremisePreviewSchema.safeParse({ candidateId: 'c', premise: {} }).success).toBe(false);
  expect(AdoptPremiseBodySchema.safeParse({ candidateId: '' }).success).toBe(false);
});

it.each(['idle', 'done', 'failed'])(
  '预览恢复 %s 状态，不修改正式种子/进度/checkpoint',
  async (status) => {
    await prisma.project.update({ where: { id }, data: { status } });
    const old = await formal();
    const clear = jest.spyOn(pipeline, 'clearPremiseCheckpoint');
    const candidate = await service.preview(id, body());
    expect(candidate.premise.coreConflict).toBe('修改后的冲突');
    expect(await formal()).toEqual(old);
    expect(await project()).toMatchObject({
      status,
      currentStage: 'outline',
      runId: null,
      promptTokens: 20,
    });
    expect(clear).not.toHaveBeenCalled();
  },
);

it('种子修改沿用文风版本，不覆盖阅读体验与视角', async () => {
  const current = await project();
  await prisma.project.update({
    where: { id },
    data: {
      answers: JSON.stringify({
        ...JSON.parse(current.answers),
        writingStyle: { id: 'short-satisfying', version: 'v1' },
      }),
    },
  });
  await service.preview(id, body());
  const prompt = completeStructured.mock.calls[0][1][0].content as string;
  expect(prompt).toContain('短篇爽文 v1');
  expect(prompt).toContain('阅读体验（tone 表示整体情绪）');
  expect(prompt).toContain('第三人称');
  expect(prompt).toContain('契约搭档');
});

it('模型输入遵守问卷并始终使用正式种子，支持历史种子', async () => {
  const legacy = { ...sample, storyEngine: undefined };
  await prisma.premise.update({ where: { projectId: id }, data: { data: JSON.stringify(legacy) } });
  await service.preview(id, body());
  await service.preview(id, body());
  const messages = completeStructured.mock.calls[1][1] as Array<{ content: string }>;
  expect(messages[0].content).toContain('当前正式种子：');
  expect(messages[0].content).toContain(sample.coreConflict);
  expect(messages[0].content).not.toContain('修改后的冲突');
  expect(messages[0].content).toContain('契约搭档');
  expect(messages[0].content).toContain('第三人称');
  expect(messages[0].content).toContain('血腥');
});

it('重复生成返回同一候选且不重复调用和统计用量', async () => {
  const input = body();
  const first = await service.preview(id, input);
  expect(await service.preview(id, input)).toEqual(first);
  expect(completeStructured).toHaveBeenCalledTimes(1);
  expect((await project()).promptTokens).toBe(20);
  await expect(service.preview(id, { ...input, feedback: '不同建议' })).rejects.toThrow('不同建议');
});

it('新预览失败保留旧候选和正式种子，失败用量只统计一次', async () => {
  const good = await service.preview(id, body());
  completeStructured.mockRejectedValue(new Error('模型不可用'));
  const failed = body();
  await expect(service.preview(id, failed)).rejects.toThrow('模型不可用');
  expect(
    await prisma.premiseRevision.findUnique({ where: { id: good.candidateId } }),
  ).toMatchObject({ status: 'done' });
  expect(JSON.parse((await formal()).data)).toEqual(sample);
  expect(await project()).toMatchObject({ status: 'idle', runId: null, promptTokens: 40 });
  await expect(service.preview(id, failed)).rejects.toThrow('模型不可用');
  expect((await project()).promptTokens).toBe(40);
  await service.adopt(id, good.candidateId);
  expect(JSON.parse((await formal()).data).coreConflict).toBe('修改后的冲突');
});

it('预览与流水线双向互斥，超时后迟到结果不得提交', async () => {
  let finish!: (value: unknown) => void;
  completeStructured.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  Object.assign(service, { previewTimeoutMs: 80 });
  const pending = service.preview(id, body());
  const observed = expect(pending).rejects.toThrow('超时');
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 1));
  await expect(service.preview(id, body())).rejects.toThrow('正在运行');
  await expect(service.adopt(id, 'any')).rejects.toThrow('正在运行');
  await expect(pipeline.generate(id)).rejects.toThrow('正在进行');
  await expect(pipeline.confirm(id)).rejects.toThrow();
  await expect(pipeline.rollback(id, 'premise')).rejects.toThrow('正在运行');
  await observed;
  finish({ premise: sample, changeNotes: [] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(await project()).toMatchObject({ status: 'idle', runId: null });
  expect(await prisma.premiseRevision.findFirst({ where: { projectId: id } })).toMatchObject({
    status: 'failed',
    data: null,
  });
  expect(JSON.parse((await formal()).data)).toEqual(sample);
  await prisma.project.update({ where: { id }, data: { status: 'running', runId: 'other' } });
  await expect(service.preview(id, body())).rejects.toThrow('正在运行');
});

it('无种子、空建议和已删除项目拒绝生成', async () => {
  await expect(service.preview(id, { ...body(), feedback: '  ' })).rejects.toThrow();
  await prisma.premise.update({ where: { projectId: id }, data: { status: 'pending' } });
  await expect(service.preview(id, body())).rejects.toThrow('正式种子');
  await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
  await expect(service.preview(id, body())).rejects.toThrow('不存在');
  await expect(service.adopt(id, 'c')).rejects.toThrow('不存在');
  expect(completeStructured).not.toHaveBeenCalled();
});

it('采用校验归属和基础种子，采用后不允许旧候选再次回退', async () => {
  const candidate = await service.preview(id, body());
  const other = await prisma.project.create({
    data: { title: '其他', genre: 'dushi', length: 'short', currentStage: 'premise' },
  });
  await expect(service.adopt(other.id, candidate.candidateId)).rejects.toThrow('不存在');
  await service.adopt(id, candidate.candidateId);
  await prisma.project.update({ where: { id }, data: { currentStage: 'characters' } });
  await service.adopt(id, candidate.candidateId);
  expect((await project()).currentStage).toBe('characters');
  const next = await service.preview(id, body());
  await prisma.premise.update({ where: { projectId: id }, data: { data: JSON.stringify(sample) } });
  await expect(service.adopt(id, next.candidateId)).rejects.toThrow('已经变化');
});

it('清理 checkpoint 失败或事务中途失败时不部分采用，可重试', async () => {
  const candidate = await service.preview(id, body());
  const clear = jest
    .spyOn(pipeline, 'clearPremiseCheckpoint')
    .mockRejectedValueOnce(new Error('清理失败'));
  await expect(service.adopt(id, candidate.candidateId)).rejects.toThrow('清理失败');
  expect(JSON.parse((await formal()).data)).toEqual(sample);
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER fail_adoption BEFORE UPDATE OF adoptedAt ON PremiseRevision BEGIN SELECT RAISE(ABORT, '提交失败'); END`,
  );
  await expect(service.adopt(id, candidate.candidateId)).rejects.toThrow();
  expect(JSON.parse((await formal()).data)).toEqual(sample);
  expect((await project()).currentStage).toBe('outline');
  await prisma.$executeRawUnsafe('DROP TRIGGER fail_adoption');
  clear.mockRestore();
  await service.adopt(id, candidate.candidateId);
  expect((await project()).currentStage).toBe('premise');
});

it('重启时恢复中断预览的原状态，不污染创作进度', async () => {
  await prisma.project.update({ where: { id }, data: { status: 'running', runId: 'preview-run' } });
  await prisma.premiseRevision.create({
    data: {
      projectId: id,
      ...body(),
      runId: 'preview-run',
      baseHash: 'hash',
      originalStatus: 'done',
    },
  });
  await pipeline.onModuleInit();
  expect(await project()).toMatchObject({ status: 'done', runId: null, currentStage: 'outline' });
  expect(await prisma.premiseRevision.findFirst({ where: { projectId: id } })).toMatchObject({
    status: 'failed',
  });
});

it('采用事务使大纲/正文确认失效，跳过该类型不含的世界观并保留原内容', async () => {
  const world = await prisma.worldSetting.create({
    data: { projectId: id, status: 'done', data: '{"原文":"世界"}' },
  });
  await prisma.outline.create({
    data: {
      projectId: id,
      targetChapters: 1,
      revision: 2,
      planRevision: 1,
      planConfirmedRevision: 1,
      confirmedRevision: 2,
      planData: '{"原文":"规划"}',
    },
  });
  await prisma.proseBook.create({
    data: {
      projectId: id,
      targetChapters: 1,
      chapters: {
        create: {
          chapterNumber: 1,
          relativePath: 'chapter-1.md',
          confirmedHash: 'old',
          observedHash: 'old',
          reviewStatus: 'confirmed',
        },
      },
    },
  });
  const candidate = await service.preview(id, body());
  await service.adopt(id, candidate.candidateId);
  expect(await prisma.outline.findUnique({ where: { projectId: id } })).toMatchObject({
    stale: true,
    confirmedRevision: null,
    planConfirmedRevision: null,
    planData: '{"原文":"规划"}',
  });
  expect(await prisma.proseChapter.findFirst({ where: { book: { projectId: id } } })).toMatchObject(
    {
      stale: true,
      confirmedHash: null,
      reviewStatus: 'needs_review',
      relativePath: 'chapter-1.md',
    },
  );
  expect(await prisma.worldSetting.findUnique({ where: { id: world.id } })).toMatchObject({
    stale: false,
  });
});

it('摘要与候选原子保存，重复请求读取原摘要，损坏摘要不阻碍查看与采用', async () => {
  const input = body();
  const candidate = await service.preview(id, input);
  expect(candidate.changeSummary?.changes).toMatchObject([
    {
      path: 'coreConflict',
      before: sample.coreConflict,
      after: '修改后的冲突',
      description: '加强核心矛盾',
      descriptionSource: 'ai',
    },
  ]);
  const stored = await prisma.premiseRevision.findUniqueOrThrow({
    where: { id: candidate.candidateId },
  });
  expect(JSON.parse(stored.changeSummaryData!)).toEqual(candidate.changeSummary);
  // 当前正式种子改变后，重复请求仍读取生成时保存的摘要，不重新比对或调用 AI。
  await prisma.premise.update({
    where: { projectId: id },
    data: { data: JSON.stringify({ ...sample, theme: '页面变化' }) },
  });
  expect(await service.preview(id, input)).toEqual(candidate);
  expect(completeStructured).toHaveBeenCalledTimes(1);
  await prisma.premiseRevision.update({
    where: { id: candidate.candidateId },
    data: { changeSummaryData: '{' },
  });
  expect(await service.preview(id, input)).toMatchObject({
    changeSummary: null,
    changeSummaryWarning: expect.stringContaining('暂不可用'),
  });
  await prisma.premise.update({ where: { projectId: id }, data: { data: JSON.stringify(sample) } });
  await service.adopt(id, candidate.candidateId);
  expect(JSON.parse((await formal()).data).coreConflict).toBe('修改后的冲突');
  expect(JSON.parse((await formal()).data)).not.toHaveProperty('changeSummary');
});

it('历史候选没有摘要仍可读取和采用，新一轮失败不改写旧摘要', async () => {
  const input = body();
  const candidate = await service.preview(id, input);
  const before = await prisma.premiseRevision.findUniqueOrThrow({
    where: { id: candidate.candidateId },
  });
  completeStructured.mockResolvedValueOnce({ premise: {} });
  await expect(service.preview(id, body())).rejects.toThrow();
  expect(await prisma.premiseRevision.findUnique({ where: { id: candidate.candidateId } })).toEqual(
    before,
  );
  await prisma.premiseRevision.update({
    where: { id: candidate.candidateId },
    data: { changeSummaryData: null },
  });
  expect(await service.preview(id, input)).toMatchObject({ changeSummary: null });
  await service.adopt(id, candidate.candidateId);
  expect(JSON.parse((await formal()).data).coreConflict).toBe('修改后的冲突');
});
