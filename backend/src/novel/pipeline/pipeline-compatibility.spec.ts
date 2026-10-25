import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { PrismaService } from '../prisma.service.js';
import { createCheckpointer } from './checkpointer.js';
import { compilePipelineGraph } from './pipeline.graph.js';
import {
  migratePipeline,
  versionedCheckpointer,
  discardLegacyCheckpoint,
} from './pipeline-compatibility.js';

it('旧节拍项目转入正文或大纲，丢弃旧图快照并保留产物；新图快照重启后可续跑', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rill-without-beats-'));
  const dbFile = join(directory, 'test.db');
  const db = new DatabaseSync(dbFile);
  const migrations = fileURLToPath(new URL('../../../prisma/migrations/', import.meta.url));
  for (const name of readdirSync(migrations).sort()) {
    if (!name.includes('.')) db.exec(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'));
  }
  db.close();
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbFile}`;
  const prisma = new PrismaService();
  if (oldUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldUrl;
  const saver = createCheckpointer(join(directory, 'cp.db'));
  try {
    const ready = await prisma.project.create({
      data: {
        title: '旧节拍项目',
        genre: 'dushi',
        length: 'short',
        currentStage: 'beats',
        status: 'failed',
        outline: {
          create: { targetChapters: 1, revision: 2, confirmedRevision: 2, planData: '保留规划' },
        },
        proseBook: {
          create: {
            targetChapters: 1,
            chapters: {
              create: {
                chapterNumber: 1,
                relativePath: 'chapters/001.md',
                confirmedHash: 'existing-proof',
                beatChapterRevision: 7,
              },
            },
          },
        },
      },
    });
    const unready = await prisma.project.create({
      data: {
        title: '失效大纲',
        genre: 'dushi',
        length: 'short',
        currentStage: 'beats',
        outline: { create: { targetChapters: 1, revision: 2, confirmedRevision: 2, stale: true } },
      },
    });
    const graph = compilePipelineGraph({
      stages: ['outline', 'prose'],
      runner: async () => ({}),
      checkpointer: saver,
      mode: 'manual',
    });
    const input = {
      projectId: ready.id,
      genre: 'dushi' as const,
      mode: 'manual' as const,
      currentStage: 'outline' as const,
      answers: { genre: 'dushi' as const, length: 'short' as const, tone: '温暖', pov: '第三人称' },
    };
    const config = { configurable: { thread_id: ready.id } };
    await graph.invoke(input, config);
    expect(await saver.getTuple(config)).toBeDefined();
    await migratePipeline(prisma, saver);
    expect(await saver.getTuple(config)).toBeUndefined();
    expect(await prisma.project.findUnique({ where: { id: ready.id } })).toMatchObject({
      currentStage: 'prose',
      status: 'idle',
    });
    expect(await prisma.project.findUnique({ where: { id: unready.id } })).toMatchObject({
      currentStage: 'outline',
    });
    expect(
      await prisma.proseChapter.findFirst({ where: { book: { projectId: ready.id } } }),
    ).toMatchObject({ confirmedHash: 'existing-proof', beatChapterRevision: 7 });
    expect(await prisma.outline.findUnique({ where: { projectId: ready.id } })).toMatchObject({
      planData: '保留规划',
    });
    const newGraph = compilePipelineGraph({
      stages: ['outline', 'prose'],
      runner: async () => ({}),
      checkpointer: versionedCheckpointer(saver),
      mode: 'manual',
    });
    await newGraph.invoke(input, config);
    const current = await saver.getTuple(config);
    await discardLegacyCheckpoint(saver, ready.id);
    await migratePipeline(prisma, saver);
    expect((await saver.getTuple(config))?.checkpoint.id).toBe(current?.checkpoint.id);
    expect(await newGraph.invoke(null, config)).toMatchObject({ projectId: ready.id });
  } finally {
    await prisma.$disconnect();
    saver.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
