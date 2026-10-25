const jest = import.meta.jest;
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ConfigService } from '@nestjs/config';
import {
  ProseFailedReviewSchema,
  ProseReviewOutputSchema,
  ProseSummaryGenerationSchema,
} from '@rill/shared';
import { PrismaService } from '../prisma.service.js';
import { ArtifactRegistry } from '../pipeline/artifact.registry.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { executionContext } from '../pipeline/execution-context.js';
import { ProseFilesService } from './prose-files.service.js';
import { ProseService } from './prose.service.js';
import type { UpstreamAssembler } from '../pipeline/upstream.assembler.js';
import type { LlmService } from '../../ai/llm.service.js';
import type { UsageRecorder } from '../../ai/observability/usage-recorder.js';

const scores = {
  consistency: 90,
  character: 90,
  pacing: 90,
  continuity: 90,
  foreshadow: 90,
  hook: 90,
  aesthetic: 90,
};
describe('正文文件与审核接受流程', () => {
  let prisma: PrismaService;
  let directory: string;
  let service: ProseService;
  let files: ProseFilesService;
  let id: string;
  let failSummary = false;
  let verdict: 'accept' | 'error' | 'critical' = 'accept';
  const complete = jest.fn();
  const structured = jest.fn();
  const run = async <T>(action: () => Promise<T>) =>
    executionContext.run(
      { projectId: id, runId: 'test-run', signal: new AbortController().signal },
      action,
    );
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'rill-prose-'));
    const databaseFile = join(directory, 'test.db');
    const database = new DatabaseSync(databaseFile);
    const migrations = fileURLToPath(new URL('../../../prisma/migrations/', import.meta.url));
    for (const entry of readdirSync(migrations, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      database.exec(readFileSync(join(migrations, entry.name, 'migration.sql'), 'utf8'));
    database.close();
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${databaseFile}`;
    try {
      prisma = new PrismaService();
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });
  beforeEach(async () => {
    failSummary = false;
    verdict = 'accept';
    complete.mockReset();
    structured.mockReset();
    const project = await prisma.project.create({
      data: {
        title: '正文测试',
        genre: 'dushi',
        length: 'short',
        answers: JSON.stringify({ genre: 'dushi', length: 'short', tone: '温暖', pov: '第三人称' }),
        currentStage: 'prose',
        status: 'running',
        runId: 'test-run',
        outline: { create: { targetChapters: 3, confirmedRevision: 0 } },
      },
    });
    id = project.id;
    const config = new ConfigService({ PROSE_OUTPUT_DIR: directory });
    files = new ProseFilesService(config);
    const assembler = {
      assemble: async () => ({ outline: { plan: {}, chapters: [] } }),
    } as unknown as UpstreamAssembler;
    complete.mockResolvedValue({
      content: '# 正文\n\n林澈推开门，发现了信。',
      finishReason: 'stop',
    });
    structured.mockImplementation(async (schema) => {
      if (schema === ProseReviewOutputSchema)
        return {
          scores,
          issues:
            verdict === 'accept'
              ? []
              : [
                  {
                    dimension: 'consistency',
                    severity: verdict,
                    problem: '设定冲突',
                    evidence: ['林澈推开门'],
                    location: '第一段',
                    basis: '门被封锁',
                    suggestion: '解释开门原因',
                  },
                ],
        };
      if (failSummary) {
        failSummary = false;
        throw new Error('摘要临时失败');
      }
      return {
        events: ['林澈发现信'],
        characterChanges: [],
        foreshadowing: ['信的来源未知'],
        continuity: '接着调查信件',
      };
    });
    service = new ProseService(
      prisma,
      new ArtifactRegistry(),
      assembler,
      { complete, completeStructured: structured } as unknown as LlmService,
      new PromptRegistry(),
      { get: () => ({ promptTokens: 2, completionTokens: 3 }) } as unknown as UsageRecorder,
      files,
      config,
    );
  });
  const acceptFirst = async () => {
    const detail = await service.detail(id);
    const c = detail.chapters.find((c) => c.machineStep !== 'done')!;
    await run(() =>
      service.accept(id, c.chapterNumber, {
        expectedRevision: c.revision,
        expectedHash: c.observedHash!,
        reviewId: c.report!.id,
        summaryId: c.summary!.id,
      }),
    );
    return c;
  };
  const invalidReview = (previous = false) => ({
    scores,
    issues: [
      {
        dimension: 'aesthetic',
        severity: 'error',
        problem: '表达问题',
        evidence: [previous ? '林澈推开门' : '不存在的原文'],
        location: '第一段',
        basis: '引用核验',
        suggestion: '调整表达',
        ...(previous
          ? { previousEvidence: { chapterNumber: 99, quotes: ['不存在的前文摘要'] } }
          : {}),
      },
    ],
  });
  const failedReview = () =>
    prisma.proseReview.findFirstOrThrow({
      where: { chapter: { book: { projectId: id } }, status: 'failed' },
      orderBy: { createdAt: 'desc' },
    });
  it('正文与审核使用项目文风，事实摘要不注入表达规则', async () => {
    await prisma.project.update({
      where: { id },
      data: {
        answers: JSON.stringify({
          genre: 'dushi',
          length: 'short',
          tone: '暗黑',
          pov: '第三人称限知',
          writingStyle: { id: 'short-satisfying', version: 'v1' },
        }),
      },
    });
    await run(() => service.process(id));
    expect(complete.mock.calls[0][0][0].content).toContain('短篇爽文 v1');
    expect(complete.mock.calls[0][0][0].content).toContain('实际后果');
    const review = structured.mock.calls.find((call) => call[0] === ProseReviewOutputSchema);
    expect(review?.[1][0].content).toContain('默认 warning');
    const summary = structured.mock.calls.find((call) => call[0] === ProseSummaryGenerationSchema);
    expect(summary?.[1][0].content).not.toContain('【文风：');
    const chapter = (await service.detail(id)).chapters[0];
    expect(chapter.report).not.toBeNull();
  });

  it('真实跨段证据逐段通过，原文省略号可引用，使用审核 v3', async () => {
    const quotes = [
      '灵药辨识——我把止血草往“观赏花卉”那堆里一扔，教习的脸都绿了。',
      '旁边还有一行小字：许一交白卷一份，无字，而大道无言，故列榜首。',
      '……我什么时候交白卷了？',
    ];
    complete.mockResolvedValueOnce({
      content: '# 第一章\n\n' + quotes.join('\n\n第二天，成绩贴出来了。\n\n'),
    });
    const data = invalidReview();
    data.issues[0].severity = 'warning';
    data.issues[0].evidence = quotes;
    structured.mockResolvedValueOnce(data);
    await run(() => service.process(id));
    const chapter = (await service.detail(id)).chapters[0];
    expect(chapter.report?.issues[0].evidence).toEqual(quotes);
    expect(chapter.report?.promptVersion).toBe('v3');
    expect(chapter.summary).not.toBeNull();
    const prompt = structured.mock.calls[0][1][0].content;
    expect(prompt).toContain('不得自行添加省略号');
    expect(prompt).toContain('evidence:["第一处连续原文","另一处连续原文"]');
  });
  it.each(['虚构片段', '拼接省略号', '删除换行'])(
    '数组第二段无效时阻断并记录片段下标：%s',
    async (scenario) => {
      const first = '灵药辨识——我把止血草往“观赏花卉”那堆里一扔，教习的脸都绿了。';
      const second = '旁边还有一行小字：许一交白卷一份，无字，而大道无言，故列榜首。';
      const content = '# 正文\n\n' + first + '\n\n' + second;
      complete.mockResolvedValueOnce({ content });
      const output = invalidReview();
      output.issues[0].evidence = [
        first,
        scenario === '拼接省略号'
          ? first + '……' + second
          : scenario === '删除换行'
            ? first + second
            : '虚构的正文',
      ];
      structured.mockResolvedValueOnce(output);
      await expect(run(() => service.process(id))).rejects.toThrow('issues[0].evidence[1]');
      const review = await failedReview();
      expect(JSON.parse(review.data!).output).toEqual(output);
      expect((await service.detail(id)).chapters[0].summary).toBeNull();
      expect(await readFile(await files.path(id, 'chapters/001.md'), 'utf8')).toBe(content);
    },
  );
  it.each(['有效', '错章', '片段不存在', '跨字段拼接'])(
    '跨章数组在指定摘要字段内逐段核验：%s',
    async (scenario) => {
      await run(() => service.process(id));
      await acceptFirst();
      const output = invalidReview();
      output.issues[0].severity = 'warning';
      output.issues[0].evidence = ['林澈推开门', '发现了信'];
      const previousEvidence = {
        chapterNumber: scenario === '错章' ? 99 : 1,
        quotes: [
          '林澈发现信',
          scenario === '片段不存在'
            ? '不存在'
            : scenario === '跨字段拼接'
              ? '林澈发现信\n信的来源未知'
              : '接着调查信件',
        ],
      };
      structured.mockResolvedValueOnce({
        ...output,
        issues: [{ ...output.issues[0], previousEvidence }],
      });
      if (scenario === '有效') {
        await run(() => service.process(id));
        expect((await service.detail(id)).chapters[1].report?.issues[0].previousEvidence).toEqual(
          previousEvidence,
        );
      } else {
        await expect(run(() => service.process(id))).rejects.toThrow(
          `previousEvidence.quotes[${scenario === '错章' ? 0 : 1}]`,
        );
        const chapter = (await service.detail(id)).chapters[1];
        expect(chapter.report).toBeNull();
        expect(chapter.summary).toBeNull();
      }
    },
  );
  it('旧字符串报告只在读取时转换，历史文件与数据库不变，接受保持幂等', async () => {
    await run(() => service.process(id));
    await acceptFirst();
    const output = invalidReview();
    output.issues[0].severity = 'warning';
    output.issues[0].evidence = ['林澈推开门'];
    structured.mockResolvedValueOnce({
      ...output,
      issues: [
        { ...output.issues[0], previousEvidence: { chapterNumber: 1, quotes: ['林澈发现信'] } },
      ],
    });
    await run(() => service.process(id));
    const current = (await service.detail(id)).chapters[1];
    const report = await prisma.proseReview.findUniqueOrThrow({
      where: { id: current.report!.id },
    });
    const legacy = {
      ...JSON.parse(report.data!),
      issues: [
        {
          ...output.issues[0],
          evidence: '林澈推开门',
          previousEvidence: { chapterNumber: 1, quote: '林澈发现信' },
        },
      ],
    };
    const legacyJson = JSON.stringify(legacy);
    await prisma.proseReview.update({
      where: { id: report.id },
      data: { data: legacyJson, promptVersion: 'v1' },
    });
    const path = await files.path(id, `reviews/2-${report.id}.json`);
    await writeFile(path, legacyJson);
    const chapter = (await service.detail(id)).chapters[1];
    expect(chapter.report?.issues[0].evidence).toEqual(['林澈推开门']);
    expect(chapter.report?.issues[0].previousEvidence).toEqual({
      chapterNumber: 1,
      quotes: ['林澈发现信'],
    });
    const body = {
      expectedRevision: chapter.revision,
      expectedHash: chapter.observedHash!,
      reviewId: report.id,
      summaryId: chapter.summary!.id,
    };
    const calls = structured.mock.calls.length;
    expect(await run(() => service.accept(id, 2, body))).toBe(true);
    expect(await run(() => service.accept(id, 2, body))).toBe(false);
    expect(structured.mock.calls.length).toBe(calls);
    await service.detail(id);
    expect(await readFile(path, 'utf8')).toBe(legacyJson);
    expect((await prisma.proseReview.findUniqueOrThrow({ where: { id: report.id } })).data).toBe(
      legacyJson,
    );
  });
  it.each(['本章引用', '跨章引用', '结构异常', '调用无结果'])(
    '失败诊断保存数据库及文件：%s，且不能作为接受依据',
    async (scenario) => {
      const output =
        scenario === '结构异常'
          ? { unexpected: '保留未经结构校验的对象' }
          : invalidReview(scenario === '跨章引用');
      if (scenario === '调用无结果') structured.mockRejectedValueOnce(new Error('审核服务不可用'));
      else structured.mockResolvedValueOnce(output);
      await expect(run(() => service.process(id))).rejects.toThrow();
      const review = await failedReview();
      const diagnostic = ProseFailedReviewSchema.parse(JSON.parse(review.data!));
      const chapter = (await service.detail(id)).chapters[0];
      expect(diagnostic).toMatchObject({
        formatVersion: 1,
        status: 'failed',
        reviewId: review.id,
        chapterNumber: 1,
        sourceHash: chapter.observedHash,
        dependencyFingerprint: review.dependencyFingerprint,
        promptVersion: review.promptVersion,
        error: review.error,
        output: scenario === '调用无结果' ? null : output,
      });
      expect(Number.isNaN(Date.parse(diagnostic.failedAt))).toBe(false);
      if (scenario === '本章引用') expect(diagnostic.error).toContain('issues[0].evidence[0]');
      if (scenario === '跨章引用')
        expect(diagnostic.error).toContain('issues[0].previousEvidence.quotes[0]');
      expect(
        JSON.parse(
          await readFile(await files.path(id, `reviews/1-${review.id}-failed.json`), 'utf8'),
        ),
      ).toEqual(diagnostic);
      expect(review.verdict).toBeNull();
      expect(chapter.report).toBeNull();
      expect(chapter.summary).toBeNull();
      expect(await prisma.proseSummary.count({ where: { chapterId: review.chapterId } })).toBe(0);
      expect(await readFile(await files.path(id, 'chapters/001.md'), 'utf8')).toBe(
        '# 正文\n\n林澈推开门，发现了信。',
      );
      const version = {
        expectedRevision: chapter.revision,
        expectedHash: chapter.observedHash!,
        reviewId: review.id,
      };
      await expect(
        run(() => service.override(id, 1, { ...version, reason: '保留作者选择' })),
      ).rejects.toThrow('没有可覆盖的有效审核结论');
      await expect(
        run(() => service.accept(id, 1, { ...version, summaryId: 'missing-summary' })),
      ).rejects.toThrow();
      expect(structured).toHaveBeenCalledTimes(1);
    },
  );
  it('重复审核失败后成功仍保留每次诊断，不重生成正文', async () => {
    structured.mockResolvedValueOnce(invalidReview());
    await expect(run(() => service.process(id))).rejects.toThrow('证据');
    const first = await failedReview();
    const firstPath = await files.path(id, `reviews/1-${first.id}-failed.json`);
    const firstContent = await readFile(firstPath, 'utf8');
    structured.mockRejectedValueOnce(new Error('第二次审核失败'));
    await expect(run(() => service.process(id))).rejects.toThrow('第二次审核失败');
    const second = await failedReview();
    expect(second.id).not.toBe(first.id);
    const secondPath = await files.path(id, `reviews/1-${second.id}-failed.json`);
    const secondContent = await readFile(secondPath, 'utf8');
    await run(() => service.process(id));
    const chapter = (await service.detail(id)).chapters[0];
    expect(chapter.report?.verdict).toBe('accept');
    expect(chapter.summary).not.toBeNull();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await readFile(firstPath, 'utf8')).toBe(firstContent);
    expect(await readFile(secondPath, 'utf8')).toBe(secondContent);
    expect(await prisma.proseReview.findUnique({ where: { id: first.id } })).toEqual(first);
    expect(await prisma.proseReview.findUnique({ where: { id: second.id } })).toEqual(second);
  });
  it('失败报告投影不可写时保留数据库诊断并同时提示两类错误', async () => {
    const projection = files.projection.bind(files);
    const spy = jest
      .spyOn(files, 'projection')
      .mockImplementation(async (projectId, name, data) => {
        if (name.endsWith('-failed.json')) throw new Error('模拟磁盘不可写');
        return projection(projectId, name, data);
      });
    structured.mockResolvedValueOnce(invalidReview());
    try {
      await expect(run(() => service.process(id))).rejects.toThrow(
        '审核证据不在本章原文中（issues[0].evidence[0]）；失败审核报告文件写入失败',
      );
    } finally {
      spy.mockRestore();
    }
    const review = await failedReview();
    const diagnostic = ProseFailedReviewSchema.parse(JSON.parse(review.data!));
    expect(diagnostic.output).toEqual(invalidReview());
    expect(diagnostic.error).toContain('审核证据不在本章原文中');
    expect(review.error).toContain('失败审核报告文件写入失败');
    expect(review.verdict).toBeNull();
    await expect(
      readFile(await files.path(id, `reviews/1-${review.id}-failed.json`), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const chapter = (await service.detail(id)).chapters[0];
    expect(chapter.report).toBeNull();
    expect(chapter.error).toContain('失败审核报告文件写入失败');
    expect(chapter.summary).toBeNull();
  });
  it('审核返回时运行权已被替换，不提交失败诊断或投影', async () => {
    structured.mockImplementationOnce(async () => {
      await prisma.project.update({ where: { id }, data: { runId: 'replacement-run' } });
      return invalidReview();
    });
    await expect(run(() => service.process(id))).rejects.toThrow('运行已失效');
    const review = await prisma.proseReview.findFirstOrThrow({
      where: { chapter: { book: { projectId: id } } },
    });
    expect(review.status).toBe('generating');
    expect(review.data).toBeNull();
    await expect(
      readFile(await files.path(id, `reviews/1-${review.id}-failed.json`), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await prisma.proseSummary.count({ where: { chapterId: review.chapterId } })).toBe(0);
  });
  it('三章顺序接受后完成，修改第一章保留后文并顺序复核', async () => {
    for (let n = 1; n <= 3; n++) {
      await run(() => service.process(id));
      const d = await service.detail(id);
      expect(d.completed).toBe(false);
      expect(d.chapters[n - 1].summary?.accepted).toBe(false);
      await acceptFirst();
    }
    expect((await service.detail(id)).completed).toBe(true);
    const second = await readFile(await files.path(id, 'chapters/002.md'), 'utf8');
    await writeFile(await files.path(id, 'chapters/001.md'), '# 改写\n\n林澈没有开门，而是等待。');
    await run(() => service.reconcile(id));
    const d = await service.detail(id);
    expect(d.chapters[1].reviewStatus).toBe('needs_review');
    expect(d.completed).toBe(false);
    expect(await readFile(await files.path(id, 'chapters/002.md'), 'utf8')).toBe(second);
    await expect(run(() => service.process(id, 3))).rejects.toThrow('尚未接受');
    const count = complete.mock.calls.length;
    for (let n = 1; n <= 3; n++) {
      await run(() => service.process(id));
      await acceptFirst();
    }
    expect(complete).toHaveBeenCalledTimes(count);
    expect((await service.detail(id)).completed).toBe(true);
  });
  it('摘要失败仅重试摘要，原审核和正文不重做', async () => {
    failSummary = true;
    await expect(run(() => service.process(id))).rejects.toThrow('摘要临时失败');
    await run(() => service.process(id));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(structured).toHaveBeenCalledTimes(3);
    expect((await service.detail(id)).chapters[0].summary?.accepted).toBe(false);
  });
  it('摘要生成使用专用约束和 v2，历史长摘要仍可读取并复用', async () => {
    await run(() => service.process(id));
    const call = structured.mock.calls.find(([schema]) => schema === ProseSummaryGenerationSchema);
    expect(call).toBeDefined();
    expect(call![1][0].content).toContain('不逐段复述');
    const chapter = (await service.detail(id)).chapters[0];
    const legacy = {
      ...chapter.summary!.data,
      events: Array(11).fill('旧摘要详细事件'.repeat(30)),
    };
    await prisma.proseSummary.update({
      where: { id: chapter.summary!.id },
      data: { data: JSON.stringify(legacy) },
    });
    await run(() => service.process(id));
    expect(structured).toHaveBeenCalledTimes(2);
    expect((await service.detail(id)).chapters[0].summary!.data).toEqual(legacy);
  });
  it('critical 不通过，填写理由后仍等待最终人工接受，原判保留', async () => {
    verdict = 'critical';
    await run(() => service.process(id));
    let c = (await service.detail(id)).chapters[0];
    expect(c.report?.verdict).toBe('rewrite');
    expect(c.summary).toBeNull();
    await run(() =>
      service.override(id, 1, {
        expectedRevision: c.revision,
        expectedHash: c.observedHash!,
        reviewId: c.report!.id,
        reason: '后文解释门的机关',
      }),
    );
    c = (await service.detail(id)).chapters[0];
    expect(c.report?.verdict).toBe('rewrite');
    expect(c.summary?.accepted).toBe(false);
    await acceptFirst();
    expect((await service.detail(id)).chapters[0].reviewStatus).toBe('confirmed');
  });
  it('候选不替换原文，空文件/链接被拒绝，旧运行不能提交', async () => {
    await run(() => service.process(id));
    const original = await readFile(await files.path(id, 'chapters/001.md'), 'utf8');
    complete.mockResolvedValueOnce({ content: '# 候选\n\n另一种故事。' });
    await expect(run(() => service.process(id, 1, true))).rejects.toThrow('功能已下线');
    expect(await readFile(await files.path(id, 'chapters/001.md'), 'utf8')).toBe(original);
    expect((await service.detail(id)).chapters[0].candidates).toHaveLength(0);
    await writeFile(await files.path(id, 'chapters/001.md'), '');
    await expect(run(() => service.process(id, 1))).rejects.toThrow('empty');
    await expect(files.path(id, '../escape')).rejects.toThrow('路径越界');
    await symlink(directory, join(directory, id, 'evil'));
    await expect(files.path(id, 'evil/x')).rejects.toThrow('符号链接');
    await prisma.project.update({ where: { id }, data: { runId: 'new-run' } });
    await expect(run(() => service.process(id))).rejects.toThrow('运行已失效');
  });
  it('文件发布后中断可恢复，不重复生成正文，并可重建摘要投影', async () => {
    const create = files.create.bind(files);
    const spy = jest.spyOn(files, 'create').mockImplementation(async (projectId, path, content) => {
      const result = await create(projectId, path, content);
      if (path === 'chapters/001.md') throw new Error('模拟发布后崩溃');
      return result;
    });
    await expect(run(() => service.process(id))).rejects.toThrow('模拟发布后崩溃');
    spy.mockRestore();
    await run(() => service.process(id));
    expect(complete).toHaveBeenCalledTimes(1);
    let d = await service.detail(id);
    expect(d.chapters[0].summary?.accepted).toBe(false);
    await writeFile(await files.path(id, 'summaries/001.json'), '{broken');
    await prisma.project.update({ where: { id }, data: { status: 'idle', runId: null } });
    d = await service.detail(id);
    expect(
      JSON.parse(await readFile(await files.path(id, 'summaries/001.json'), 'utf8')).sourceHash,
    ).toBe(d.chapters[0].observedHash);
  });
  it('正文生成期间本地保存不被覆盖，候选仍可见', async () => {
    complete.mockImplementationOnce(async () => {
      await files.create(id, 'chapters/001.md', '# 作者正文\n\n作者本地保存。');
      return { content: '# 模型正文\n\n另一份内容。' };
    });
    await expect(run(() => service.process(id))).rejects.toThrow('变化');
    expect(await readFile(await files.path(id, 'chapters/001.md'), 'utf8')).toContain(
      '作者本地保存',
    );
    expect((await service.detail(id)).chapters[0].candidates).toHaveLength(1);
  });
  it('无证据报告、截断正文、非法编码和旧版本接受均被拒绝', async () => {
    structured.mockResolvedValueOnce({
      scores,
      issues: [
        {
          dimension: 'aesthetic',
          severity: 'error',
          problem: '空泛问题',
          evidence: ['不存在的原文'],
          location: '第一段',
          basis: '无',
          suggestion: '修改',
        },
      ],
    });
    await expect(run(() => service.process(id))).rejects.toThrow('证据');
    expect((await service.detail(id)).chapters[0].report).toBeNull();
    await run(() => service.process(id));
    const c = (await service.detail(id)).chapters[0];
    await expect(
      run(() =>
        service.accept(id, 1, {
          expectedRevision: c.revision + 1,
          expectedHash: c.observedHash!,
          reviewId: c.report!.id,
          summaryId: c.summary!.id,
        }),
      ),
    ).rejects.toThrow('版本变化');
    complete.mockResolvedValueOnce({ content: '# 被截断\n\n半篇', finishReason: 'length' });
    await acceptFirst();
    await expect(run(() => service.process(id, 2))).rejects.toThrow('截断');
    expect((await files.read(id, 2)).status).toBe('missing');
    await writeFile(await files.path(id, 'chapters/001.md'), Buffer.from([0xff]));
    expect((await files.read(id, 1)).status).toBe('invalid_encoding');
  });
  it('上下文超预算不静默截断；单章正文失效保留此前章节', async () => {
    await run(() => service.process(id));
    await acceptFirst();
    await run(() => service.process(id));
    await acceptFirst();
    await run(() => service.invalidate(id, 2));
    let d = await service.detail(id);
    expect(d.chapters[0].reviewStatus).toBe('confirmed');
    expect(d.chapters[1].stale).toBe(true);
    await writeFile(await files.path(id, 'chapters/002.md'), '字'.repeat(180001));
    await expect(run(() => service.process(id, 2))).rejects.toThrow('超过预算');
    d = await service.detail(id);
    expect(d.chapters[1].content!.length).toBe(180001);
    expect(d.chapters[1].report).toBeNull();
  });
  it('模型迟到返回后旧运行不能发布正文', async () => {
    complete.mockImplementationOnce(async () => {
      await prisma.project.update({ where: { id }, data: { runId: 'replacement-run' } });
      return { content: '# 迟到结果\n\n不得发布。' };
    });
    await expect(run(() => service.process(id))).rejects.toThrow('运行已失效');
    expect((await files.read(id, 1)).status).toBe('missing');
  });
  it.each([NaN, 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    '服务拒绝非法章号 %s 且不生成任何内容',
    async (number) => {
      await expect(run(() => service.process(id, number, true))).rejects.toThrow('章号');
      expect(complete).not.toHaveBeenCalled();
      expect(structured).not.toHaveBeenCalled();
      expect(await prisma.proseBook.findUnique({ where: { projectId: id } })).toBeNull();
    },
  );
});
