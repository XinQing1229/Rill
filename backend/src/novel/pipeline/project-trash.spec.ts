import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuestionnaireAnswers } from '@rill/shared';

import { copyFileSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaService } from '../prisma.service.js';
import { QuestionnaireService } from '../questionnaire/questionnaire.js';
import { ArtifactRegistry, StageGenerator } from './artifact.registry.js';
import { createCheckpointer } from './checkpointer.js';
import { PipelineService } from './pipeline.service.js';
import { UpstreamAssembler } from './upstream.assembler.js';
import { storageFor } from './stage-storage.js';

// 后端为 ESM，测试同样以 ESM 运行，用 import.meta.url 推导目录而非 __dirname。
// 使用独立数据库：套件并行执行时会互相 deleteMany，共享 pipeline-test.db 会互相清数据。
const dbFile = join(dirname(fileURLToPath(import.meta.url)), '../../../project-trash-test.db');
process.env.DATABASE_URL = `file:${dbFile}`;

const answers: QuestionnaireAnswers = {
  genre: 'xuanhuan',
  length: 'short',
  tone: '热血',
  pov: '第一人称',
};

function fakeGenerator(stage: 'premise', impl?: () => Promise<void>): StageGenerator {
  return {
    stage,
    requires: () => [],
    generate: impl ?? (async () => undefined),
  };
}

/** 构造一个 checkpoint 快照，用于验证永久删除时流水线快照被清理 */
async function putCheckpoint(file: string, threadId: string): Promise<void> {
  const saver = createCheckpointer(file);
  try {
    await saver.put(
      { configurable: { thread_id: threadId } },
      {
        v: 1,
        id: 'cp-1',
        ts: new Date().toISOString(),
        channel_values: { currentStage: 'premise' },
        channel_versions: { currentStage: 1 },
        versions_seen: {},
      },
      { source: 'loop', step: 1, parents: {} },
    );
  } finally {
    saver.db.close();
  }
}

describe('项目软删除与回收站', () => {
  let prisma: PrismaService;
  let artifacts: ArtifactRegistry;
  let service: PipelineService;
  let checkpointFile: string;
  let checkpointDir: string;

  beforeAll(async () => {
    // 从 globalSetup 已迁移的库复制独立副本，避免与其他套件互相清理数据。
    copyFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../pipeline-test.db'),
      dbFile,
    );
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    // 清理独立库文件，避免残留影响下一次运行
    fs.rmSync(dbFile, { force: true });
    fs.rmSync(`${dbFile}-journal`, { force: true });
    fs.rmSync(`${dbFile}-wal`, { force: true });
    fs.rmSync(`${dbFile}-shm`, { force: true });
  });

  beforeEach(async () => {
    await prisma.relation.deleteMany();
    await prisma.character.deleteMany();
    await prisma.worldSetting.deleteMany();
    await prisma.premise.deleteMany();
    await prisma.outlineUsage.deleteMany();
    await prisma.project.deleteMany();

    checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-trash-'));
    checkpointFile = `file:${path.join(checkpointDir, 'cp.db')}`;
    const config = {
      get: () => checkpointFile,
    } as unknown as ConfigService;

    artifacts = new ArtifactRegistry();
    artifacts.registerGenerator(fakeGenerator('premise'));
    artifacts.register('premise', async (projectId, stale) => {
      await prisma.premise.updateMany({ where: { projectId }, data: { stale } });
    });
    const assembler = new UpstreamAssembler(prisma, artifacts);
    service = new PipelineService(prisma, new QuestionnaireService(), artifacts, assembler, config);
    await service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    fs.rmSync(checkpointDir, { recursive: true, force: true });
  });

  it('发布状态默认创作中，可双向切换且不改写阶段、执行状态和运行锁', async () => {
    const project = await service.create({ title: '发布标记', answers });
    expect(project.publicationStatus).toBe('writing');
    await prisma.project.update({
      where: { id: project.id },
      data: { status: 'running', runId: 'publication-test' },
    });
    await service.setPublicationStatus(project.id, { publicationStatus: 'published' });
    const saved = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(saved).toMatchObject({
      publicationStatus: 'published',
      currentStage: project.currentStage,
      status: 'running',
      runId: 'publication-test',
      answers: project.answers,
    });
    expect((await service.list()).find((p) => p.id === project.id)?.publicationStatus).toBe(
      'published',
    );
    await service.setPublicationStatus(project.id, { publicationStatus: 'writing' });
    expect((await service.get(project.id)).publicationStatus).toBe('writing');
  });

  it('非法发布状态被拒绝，删除恢复保留标记且回收站项目不可修改', async () => {
    const project = await service.create({ title: '发布标记恢复', answers });
    await expect(
      service.setPublicationStatus(project.id, { publicationStatus: 'done' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.get(project.id)).publicationStatus).toBe('writing');
    await service.setPublicationStatus(project.id, { publicationStatus: 'published' });
    expect((await service.softDelete(project.id)).publicationStatus).toBe('published');
    await expect(
      service.setPublicationStatus(project.id, { publicationStatus: 'writing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.restore(project.id)).publicationStatus).toBe('published');
    await expect(
      service.setPublicationStatus('missing', { publicationStatus: 'published' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('软删除后所有创作入口都不可见', async () => {
    const project = await service.create({ title: '待删除作品', answers });

    const summary = await service.softDelete(project.id);
    expect(summary.deletedAt).toBeInstanceOf(Date);

    await expect(service.get(project.id)).rejects.toThrow(NotFoundException);
    await expect(service.generate(project.id)).rejects.toThrow(NotFoundException);
    await expect(service.characters(project.id)).rejects.toThrow(NotFoundException);
    await expect(service.relations(project.id)).rejects.toThrow(NotFoundException);

    expect((await service.list()).map((item) => item.id)).not.toContain(project.id);
    expect((await service.list('trash')).map((item) => item.id)).toContain(project.id);
  });

  it('重复删除返回不存在', async () => {
    const project = await service.create({ title: '幂等删除', answers });
    await service.softDelete(project.id);
    await expect(service.softDelete(project.id)).rejects.toThrow(NotFoundException);
  });

  it('生成中的项目拒绝删除', async () => {
    const project = await service.create({ title: '运行中作品', answers });
    await prisma.project.update({
      where: { id: project.id },
      data: { status: 'running', runId: 'run-lock' },
    });

    await expect(service.softDelete(project.id)).rejects.toThrow(ConflictException);
    expect((await prisma.project.findUnique({ where: { id: project.id } }))?.deletedAt).toBeNull();
  });

  it('重启清理不改写回收站项目的运行状态', async () => {
    const hidden = await service.create({ title: '回收站中断作品', answers });
    const visible = await service.create({ title: '创作中中断作品', answers });
    await prisma.project.updateMany({
      where: { id: { in: [hidden.id, visible.id] } },
      data: { status: 'running', runId: 'run-lock' },
    });
    await prisma.stageRun.createMany({
      data: [
        { projectId: hidden.id, runId: 'run-lock', stage: 'premise', status: 'generating' },
        { projectId: visible.id, runId: 'run-lock', stage: 'premise', status: 'generating' },
      ],
    });
    // 模拟「运行中项目被移入回收站后服务重启」
    await prisma.project.update({
      where: { id: hidden.id },
      data: { deletedAt: new Date() },
    });

    await service.onModuleInit();

    const hiddenRow = await prisma.project.findUniqueOrThrow({ where: { id: hidden.id } });
    expect(hiddenRow.status).toBe('running');
    expect(hiddenRow.runId).toBe('run-lock');
    expect((await prisma.stageRun.findFirst({ where: { projectId: hidden.id } }))?.status).toBe(
      'generating',
    );

    const visibleRow = await prisma.project.findUniqueOrThrow({ where: { id: visible.id } });
    expect(visibleRow.status).toBe('failed');
    expect(visibleRow.runId).toBeNull();
  });

  it('恢复后问答、进度、产物与失效标记完全一致', async () => {
    const project = await service.create({ title: '可恢复作品', answers });
    await service.generate(project.id, { wait: true });
    await artifacts.setStale('premise', project.id, true);
    const before = await service.get(project.id);

    await service.softDelete(project.id);
    const restored = await service.restore(project.id);

    expect({
      answers: restored.answers,
      currentStage: restored.currentStage,
      mode: restored.mode,
      genre: restored.genre,
      length: restored.length,
      questionnaireVersion: restored.questionnaireVersion,
      status: restored.status,
    }).toEqual({
      answers: before.answers,
      currentStage: before.currentStage,
      mode: before.mode,
      genre: before.genre,
      length: before.length,
      questionnaireVersion: before.questionnaireVersion,
      status: before.status,
    });
    expect(restored.premise?.data).toBe(before.premise?.data);
    expect(restored.premise?.stale).toBe(true);
    expect(restored.stageStates.premise).toEqual(before.stageStates.premise);
    expect(restored.deletedAt).toBeNull();
    expect((await service.list()).map((item) => item.id)).toContain(project.id);
  });

  it('不在回收站的项目无法恢复', async () => {
    const project = await service.create({ title: '未删除作品', answers });
    await expect(service.restore(project.id)).rejects.toThrow(NotFoundException);
  });

  it('回收站期间产物写入被静默丢弃', async () => {
    const project = await service.create({ title: '冻结作品', answers });
    await service.generate(project.id, { wait: true });
    const before = await prisma.premise.findUniqueOrThrow({ where: { projectId: project.id } });

    await service.softDelete(project.id);
    await storageFor('premise')?.write(prisma, project.id, {
      status: 'failed',
      error: '删除后不应写入',
    });
    await storageFor('premise')?.invalidate(prisma, project.id, true);

    const after = await prisma.premise.findUniqueOrThrow({ where: { projectId: project.id } });
    expect({ status: after.status, stale: after.stale, error: after.error }).toEqual({
      status: before.status,
      stale: before.stale,
      error: before.error,
    });
  });

  it('永久删除清理全部产物、用量记录与流水线快照', async () => {
    const project = await service.create({ title: '待清理作品', answers });
    await service.generate(project.id, { wait: true });
    const character = await prisma.character.create({
      data: { projectId: project.id, name: '甲', role: 'protagonist', data: '{}' },
    });
    await prisma.relation.create({
      data: {
        projectId: project.id,
        fromId: character.id,
        toId: character.id,
        type: '师徒',
        fromRole: '师父',
        toRole: '徒弟',
        description: '',
      },
    });
    await prisma.worldSetting.create({
      data: { projectId: project.id, data: '{}', status: 'done' },
    });
    await prisma.outlineUsage.create({
      data: { traceId: 'trace-1', projectId: project.id, promptTokens: 1, completionTokens: 2 },
    });
    await putCheckpoint(checkpointFile, project.id);

    await service.softDelete(project.id);
    await expect(service.purge(project.id)).resolves.toEqual({ id: project.id, purged: true });

    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await prisma.premise.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.worldSetting.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.character.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.relation.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.stageRun.count({ where: { projectId: project.id } })).toBe(0);
    // OutlineUsage 没有外键级联，必须被显式清理
    expect(await prisma.outlineUsage.count({ where: { projectId: project.id } })).toBe(0);
    const saver = createCheckpointer(checkpointFile);
    try {
      expect(await saver.getTuple({ configurable: { thread_id: project.id } })).toBeUndefined();
    } finally {
      saver.db.close();
    }
  });

  it('未删除的项目不允许永久删除', async () => {
    const project = await service.create({ title: '保护中的作品', answers });
    await expect(service.purge(project.id)).rejects.toThrow(NotFoundException);
    expect(await prisma.project.findUnique({ where: { id: project.id } })).not.toBeNull();
  });

  it('删除与后台任务并发时，后续写入与进度均不落地', async () => {
    const project = await service.create({ title: '并发删除作品', answers });
    await service.generate(project.id, { wait: true });
    await prisma.project.update({
      where: { id: project.id },
      data: { status: 'running', runId: 'run-lock' },
    });
    await prisma.premise.update({
      where: { projectId: project.id },
      data: { status: 'generating' },
    });
    const beforeRuns = await prisma.stageRun.count({ where: { projectId: project.id } });
    // 模拟后台任务进行中被移入回收站（越过运行锁）
    await prisma.project.update({
      where: { id: project.id },
      data: { deletedAt: new Date() },
    });

    await expect(service.generate(project.id)).rejects.toThrow(NotFoundException);
    await expect(service.rollback(project.id, 'premise')).rejects.toThrow(NotFoundException);

    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.status).toBe('running');
    expect(row.runId).toBe('run-lock');
    expect(
      (await prisma.premise.findUniqueOrThrow({ where: { projectId: project.id } })).status,
    ).toBe('generating');
    expect(await prisma.stageRun.count({ where: { projectId: project.id } })).toBe(beforeRuns);
  });

  it('清空回收站返回清理数量且只删回收站项目', async () => {
    const [a, b, kept] = await Promise.all([
      service.create({ title: '回收作品 A', answers }),
      service.create({ title: '回收作品 B', answers }),
      service.create({ title: '保留作品', answers }),
    ]);
    await service.softDelete(a.id);
    await service.softDelete(b.id);

    await expect(service.clearTrash()).resolves.toEqual({ removed: 2 });

    expect(await prisma.project.count()).toBe(1);
    expect((await service.list()).map((item) => item.id)).toEqual([kept.id]);
    expect(await service.list('trash')).toHaveLength(0);
  });
});
