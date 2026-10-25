const jest = import.meta.jest;
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  CreateProseRevisionBodySchema,
  ProseReviewOutputSchema,
  ProseRevisionOutputSchema,
} from '@rill/shared';
import { PrismaService } from '../prisma.service.js';
import { ProseService } from './prose.service.js';
import { ProseFilesService } from './prose-files.service.js';
import { ProseRevisionService } from './prose-revision.service.js';
import { buildProseChanges } from './prose-revision-data.js';
import { ArtifactRegistry } from '../pipeline/artifact.registry.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { executionContext } from '../pipeline/execution-context.js';
import type { LlmService } from '../../ai/llm.service.js';
import type { UpstreamAssembler } from '../pipeline/upstream.assembler.js';
import type { UsageRecorder } from '../../ai/observability/usage-recorder.js';

const scores = Object.fromEntries(
  ['consistency', 'character', 'pacing', 'continuity', 'foreshadow', 'hook', 'aesthetic'].map(
    (k) => [k, 90],
  ),
);
const original = '# 正文\n\n林澈推开门，发现了信。\n\n他开始调查。';
const changed = '# 正文\n\n林澈推开门，发现了信。他把信藏进袖中。\n\n他开始调查。';
describe('正文按建议修改', () => {
  let prisma: PrismaService,
    directory: string,
    files: ProseFilesService,
    prose: ProseService,
    revisions: ProseRevisionService,
    id: string;
  let reviewFails = false;
  const structured = jest.fn();
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'rill-revisions-'));
    const databaseFile = join(directory, 'test.db');
    const database = new DatabaseSync(databaseFile);
    const migrations = fileURLToPath(new URL('../../../prisma/migrations/', import.meta.url));
    for (const entry of readdirSync(migrations, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      database.exec(readFileSync(join(migrations, entry.name, 'migration.sql'), 'utf8'));
    database.close();
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${databaseFile}`;
    prisma = new PrismaService();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });
  beforeEach(async () => {
    structured.mockReset();
    reviewFails = false;
    const p = await prisma.project.create({
      data: {
        title: '修订测试',
        genre: 'dushi',
        length: 'short',
        currentStage: 'prose',
        answers: JSON.stringify({ genre: 'dushi', length: 'short', pov: '第三人称', tone: '温暖' }),
        outline: { create: { targetChapters: 2, confirmedRevision: 0 } },
      },
    });
    id = p.id;
    const config = new ConfigService({ PROSE_OUTPUT_DIR: directory });
    files = new ProseFilesService(config);
    await files.onModuleInit();
    structured.mockImplementation(async (schema) => {
      if (schema === ProseRevisionOutputSchema)
        return {
          outcome: 'revised',
          content: changed,
          explanation: '动作更明确',
          suggestionResponses: [],
        };
      if (schema === ProseReviewOutputSchema) {
        if (reviewFails) throw new Error('审核暂时不可用');
        return { scores, issues: [] };
      }
      return {
        events: ['发现信件'],
        characterChanges: [],
        foreshadowing: [],
        continuity: '继续调查',
      };
    });
    const llm = {
      complete: jest.fn(async () => ({ content: original, finishReason: 'stop' })),
      completeStructured: structured,
    } as unknown as LlmService;
    prose = new ProseService(
      prisma,
      new ArtifactRegistry(),
      {
        assemble: async () => ({ outline: { plan: {}, chapters: [] } }),
      } as unknown as UpstreamAssembler,
      llm,
      new PromptRegistry(),
      { get: () => ({ promptTokens: 2, completionTokens: 3 }) } as unknown as UsageRecorder,
      files,
      config,
    );
    revisions = new ProseRevisionService(prisma, prose, llm);
    await prisma.project.update({ where: { id }, data: { runId: 'initial', status: 'running' } });
    await executionContext.run(
      { projectId: id, runId: 'initial', signal: new AbortController().signal },
      () => prose.process(id, 1),
    );
    await prisma.project.update({ where: { id }, data: { status: 'idle', runId: null } });
    structured.mockClear();
  });
  afterEach(async () => {
    await revisions.onModuleDestroy();
  });
  const body = async (feedback = '增加藏信的动作') => {
    const c = (await prose.detail(id)).chapters[0];
    return {
      requestId: randomUUID(),
      expectedRevision: c.revision,
      expectedHash: c.observedHash!,
      feedback,
    };
  };
  const wait = async (revisionId: string) => {
    for (let n = 0; n < 200; n++) {
      const row = await prisma.proseRevision.findUniqueOrThrow({ where: { id: revisionId } });
      const p = await prisma.project.findUniqueOrThrow({ where: { id } });
      if (!['generating', 'applying'].includes(row.status) && p.status !== 'running') return row;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('修订未完成');
  };
  const preview = async () => {
    const result = await revisions.create(id, 1, await body());
    await wait(result.id);
    return revisions.get(id, 1, result.id);
  };
  it('预览不改正文，应用后重审与摘要但不接受，重复请求不重复调用或递增版本', async () => {
    const input = await body();
    const created = await revisions.create(id, 1, input);
    expect((await revisions.create(id, 1, input)).id).toBe(created.id);
    await wait(created.id);
    expect((await files.read(id, 1)).content).toBe(original);
    const result = await revisions.get(id, 1, created.id);
    expect(result.status).toBe('ready');
    expect(result.changes).toEqual([
      { before: '林澈推开门，发现了信。', after: '林澈推开门，发现了信。他把信藏进袖中。' },
    ]);
    const apply = {
      requestId: randomUUID(),
      expectedRevision: result.baseRevision,
      expectedHash: result.baseHash,
    };
    await revisions.apply(id, 1, result.id, apply);
    await wait(result.id);
    await revisions.apply(id, 1, result.id, apply);
    const detail = await prose.detail(id);
    expect(detail.chapters[0].content).toBe(changed);
    expect(detail.chapters[0].summary?.accepted).toBe(false);
    expect(detail.chapters[0].revision).toBe(result.baseRevision + 1);
    expect(detail.chapters[1].stale).toBe(true);
    expect(
      structured.mock.calls.filter(([schema]) => schema === ProseRevisionOutputSchema),
    ).toHaveLength(1);
    expect(
      await prisma.proseUsage.findMany({ where: { projectId: id, purpose: 'revision' } }),
    ).toHaveLength(1);
  });
  it('三选二只发送所选建议，缺少处理说明不能成为可应用预览', async () => {
    const c = (await prose.detail(id)).chapters[0];
    const stored = await prisma.proseReview.findUniqueOrThrow({ where: { id: c.report!.id } });
    const data = JSON.parse(stored.data!);
    data.issues = [0, 1, 2].map((i) => ({
      dimension: 'pacing',
      severity: 'warning',
      problem: `问题${i}`,
      evidence: ['林澈推开门'],
      location: '第二段',
      basis: '节奏',
      suggestion: `建议${i}`,
    }));
    await prisma.proseReview.update({
      where: { id: stored.id },
      data: { data: JSON.stringify(data) },
    });
    structured.mockResolvedValueOnce({
      outcome: 'revised',
      content: changed,
      explanation: '',
      suggestionResponses: [
        { issueIndex: 0, explanation: '处理0' },
        { issueIndex: 2, explanation: '处理2' },
      ],
    });
    const created = await revisions.create(id, 1, {
      ...(await body('')),
      reviewSelection: { reviewId: stored.id, issueIndexes: [0, 2] },
    });
    expect((await wait(created.id)).status).toBe('ready');
    const payload = JSON.parse(structured.mock.calls[0][1][0].content.split('\n').at(-1));
    expect(payload.suggestions.map((s: { issueIndex: number }) => s.issueIndex)).toEqual([0, 2]);
    expect(JSON.stringify(payload)).not.toContain('建议1');
    const invalid = await revisions.create(id, 1, {
      ...(await body('')),
      reviewSelection: { reviewId: stored.id, issueIndexes: [0, 2] },
    });
    expect((await wait(invalid.id)).status).toBe('failed');
    expect((await revisions.get(id, 1, created.id)).status).toBe('ready');
  });
  it('拒绝空建议、重复选择、旧报告、旧基础与跨章节读取', async () => {
    expect(CreateProseRevisionBodySchema.safeParse({ ...(await body('')) }).success).toBe(false);
    expect(
      CreateProseRevisionBodySchema.safeParse({
        ...(await body('')),
        reviewSelection: { reviewId: 'r', issueIndexes: [0, 0] },
      }).success,
    ).toBe(false);
    await expect(
      revisions.create(id, 1, {
        ...(await body()),
        reviewSelection: { reviewId: 'old', issueIndexes: [0] },
      }),
    ).rejects.toThrow('审核报告');
    const result = await preview();
    await expect(revisions.get(id, 2, result.id)).rejects.toThrow('不存在');
    await writeFile(await files.path(id, files.chapterPath(1)), original + '\n作者额外内容');
    await expect(
      revisions.apply(id, 1, result.id, {
        requestId: randomUUID(),
        expectedRevision: result.baseRevision,
        expectedHash: result.baseHash,
      }),
    ).rejects.toThrow('变化');
    expect((await revisions.get(id, 1, result.id)).status).toBe('stale');
  });
  it('放弃、冲突和无改动均不触碰正式正文', async () => {
    const result = await preview();
    expect((await revisions.discard(id, 1, result.id)).status).toBe('discarded');
    expect((await revisions.discard(id, 1, result.id)).status).toBe('discarded');
    structured.mockResolvedValueOnce({ outcome: 'blocked', explanation: '建议与大纲冲突' });
    const blocked = await revisions.create(id, 1, await body());
    expect((await wait(blocked.id)).status).toBe('blocked');
    structured.mockResolvedValueOnce({
      outcome: 'revised',
      content: original,
      explanation: '',
      suggestionResponses: [],
    });
    const same = await revisions.create(id, 1, await body());
    expect((await wait(same.id)).status).toBe('unchanged');
    expect((await files.read(id, 1)).content).toBe(original);
  });
  it('应用后审核失败保留修改，可只重试审核', async () => {
    const result = await preview();
    reviewFails = true;
    await revisions.apply(id, 1, result.id, {
      requestId: randomUUID(),
      expectedRevision: result.baseRevision,
      expectedHash: result.baseHash,
    });
    const row = await wait(result.id);
    expect(row.status).toBe('applied');
    expect(row.error).toContain('审核暂时不可用');
    expect((await files.read(id, 1)).content).toBe(changed);
    reviewFails = false;
    await prisma.project.update({ where: { id }, data: { status: 'running', runId: 'retry' } });
    await executionContext.run(
      { projectId: id, runId: 'retry', signal: new AbortController().signal },
      () => prose.process(id, 1),
    );
    await prisma.project.update({ where: { id }, data: { status: 'idle', runId: null } });
    expect((await prose.detail(id)).chapters[0].summary).not.toBeNull();
  });
  it('rename 后中断可恢复且只递增一次正文版本', async () => {
    const result = await preview();
    const replace = files.replace.bind(files);
    const spy = jest.spyOn(files, 'replace').mockImplementationOnce(async (...args) => {
      await replace(...args);
      throw new Error('模拟发布后崩溃');
    });
    await revisions.apply(id, 1, result.id, {
      requestId: randomUUID(),
      expectedRevision: result.baseRevision,
      expectedHash: result.baseHash,
    });
    expect((await wait(result.id)).status).toBe('recovery_required');
    spy.mockRestore();
    await revisions.onApplicationBootstrap();
    expect((await wait(result.id)).status).toBe('applied');
    expect((await prose.detail(id)).chapters[0].revision).toBe(result.baseRevision + 1);
  });
  it('可信快照可恢复丢失正文，正常正文拒绝恢复覆盖', async () => {
    const result = await preview();
    await revisions.apply(id, 1, result.id, {
      requestId: randomUUID(),
      expectedRevision: result.baseRevision,
      expectedHash: result.baseHash,
    });
    await wait(result.id);
    await expect(revisions.restore(id, 1)).rejects.toThrow('无需恢复');
    await rm(await files.path(id, files.chapterPath(1)));
    const broken = await prose.detail(id);
    expect(broken.chapters[0].canRestore).toBe(true);
    const restored = await revisions.restore(id, 1);
    expect(restored.chapters[0].content).toBe(changed);
    expect(restored.chapters[0].confirmedHash).toBeNull();
  });
  it('取消运行拒绝迟到结果，仍记录已经发生的修订用量', async () => {
    let resolve!: (value: unknown) => void;
    structured.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const created = await revisions.create(id, 1, await body());
    for (let n = 0; n < 100 && !resolve; n++) await new Promise((done) => setTimeout(done, 5));
    await revisions.onModuleDestroy();
    resolve({ outcome: 'revised', content: changed, explanation: '', suggestionResponses: [] });
    for (let n = 0; n < 100; n++) {
      if (await prisma.proseUsage.count({ where: { projectId: id, purpose: 'revision' } })) break;
      await new Promise((done) => setTimeout(done, 5));
    }
    expect((await files.read(id, 1)).content).toBe(original);
    expect(
      (await prisma.proseRevision.findUniqueOrThrow({ where: { id: created.id } })).status,
    ).toBe('failed');
    expect(await prisma.proseUsage.count({ where: { projectId: id, purpose: 'revision' } })).toBe(
      1,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      files.replace(id, 1, (await files.read(id, 1)).hash!, changed, controller.signal),
    ).rejects.toThrow();
    expect((await files.read(id, 1)).content).toBe(original);
  });
  it('真实差异拆分多处改动并保留中间未变段落', () => {
    expect(buildProseChanges('A\n\nB\n\nC\n\nD', 'A\n\nX\n\nC\n\nY')).toEqual([
      { before: 'B', after: 'X' },
      { before: 'D', after: 'Y' },
    ]);
  });
});
