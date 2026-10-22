// 大纲真实调用验收：仅使用临时数据库，依赖先执行 npm run build。
import 'reflect-metadata';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { config as dotenv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/src/app.module.js';
import { PrismaService } from '../dist/src/novel/prisma.service.js';
import { PipelineService } from '../dist/src/novel/pipeline/pipeline.service.js';
import { OutlineService } from '../dist/src/novel/outline/outline.service.js';

const backend = dirname(dirname(fileURLToPath(import.meta.url)));
dotenv({ path: join(backend, '.env'), quiet: true });
if (!process.env.DEEPSEEK_API_KEY) {
  console.log(JSON.stringify({ skipped: true, reason: '未配置 DEEPSEEK_API_KEY' }));
  process.exit(0);
}
const directory = mkdtempSync(join(tmpdir(), 'rill-outline-real-'));
process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`;
process.env.CHECKPOINT_DB = join(directory, 'checkpoint.db');
let app;
let step = 'prepare';
try {
  step = 'migrate';
  new DatabaseSync(join(directory, 'test.db')).close();
  execFileSync(join(backend, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: backend,
    env: process.env,
    stdio: 'pipe',
  });
  step = 'boot';
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const pipeline = app.get(PipelineService);
  const outline = app.get(OutlineService);
  step = 'fixtures';
  const project = await pipeline.create({
    title: '临时验收：旧城来信',
    answers: {
      genre: 'dushi',
      length: 'short',
      tone: '温暖',
      pov: '第三人称',
      ending: '圆满',
      idea: '青年记者在旧城改造前寻找一封未寄出的信的主人',
    },
  });
  const id = project.id;
  await prisma.project.update({ where: { id }, data: { currentStage: 'outline' } });
  await prisma.premise.update({
    where: { projectId: id },
    data: {
      status: 'done',
      data: JSON.stringify({
        title: '旧城来信',
        logline: '记者为旧城寻找未寄出信件的主人',
        theme: '理解与告别',
        coreConflict: '记者急于发布报道，老人不愿公开往事',
        protagonist: { name: '林川', identity: '记者', desire: '找到信的主人', flaw: '急于求成' },
        setting: { era: '现代', place: '旧城', socialBackground: '城市改造' },
        hook: '信件揭开旧城往事',
        taboos: [],
      }),
    },
  });
  for (const [name, role, identity, desire, flaw, arc] of [
    ['林川', 'protagonist', '记者', '找到信主', '急于求成', '学会倾听'],
    ['陈伯', 'supporting', '旧城居民', '守护往事', '不愿沟通', '接受告别'],
  ]) {
    await prisma.character.create({
      data: {
        projectId: id,
        name,
        role,
        status: 'done',
        data: JSON.stringify({
          name,
          role,
          identity,
          desire,
          flaw,
          arc,
          personality: '真诚',
          background: '在旧城生活',
          abilities: '记忆旧事',
        }),
      },
    });
  }
  await prisma.stageRun.createMany({
    data: ['premise', 'characters', 'relations'].map((stage) => ({
      projectId: id,
      stage,
      runId: 'acceptance',
      status: 'done',
      confirmedAt: new Date(),
    })),
  });
  step = 'plan-generation';
  await pipeline.generate(id, { wait: true });
  let detail = await outline.get(id);
  if (detail.step !== 'plan_review') throw new Error('step');
  step = 'plan-edit';
  await outline.savePlan(id, detail.revision, {
    ...detail.plan,
    ending: `${detail.plan.ending} 最后以旧城的一封回信收束。`,
  });
  detail = await outline.get(id);
  step = 'chapter-generation';
  await pipeline.confirm(id, 'confirm', {
    target: 'outline-plan',
    expectedRevision: detail.revision,
  });
  detail = await outline.get(id);
  step = 'chapter-edit';
  await outline.saveChapter(id, detail.revision, 1, {
    ...detail.chapters[0],
    consequence: `${detail.chapters[0].consequence} 林川决定先倾听而不急于发布。`,
  });
  detail = await outline.get(id);
  step = 'final-confirm';
  try {
    await pipeline.confirm(id, 'confirm', { target: 'outline', expectedRevision: detail.revision });
  } catch (error) {
    if (!String(error.message).includes('阶段 beats 的生成能力尚未实现')) throw error;
  }
  detail = await outline.get(id);
  const saved = await prisma.project.findUniqueOrThrow({ where: { id } });
  if (detail.step !== 'confirmed' || detail.chapters.length !== 8) throw new Error('assertion');
  console.log(
    JSON.stringify({
      success: true,
      chapters: detail.chapters.length,
      batches: detail.completedBatches,
      step: detail.step,
      planEdited: true,
      chapterEdited: true,
      promptTokens: saved.promptTokens,
      completionTokens: saved.completionTokens,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      success: false,
      step,
      errorType: error?.constructor?.name ?? 'Error',
      diagnostic: String(
        error?.output
          ? error.output
              .filter(Boolean)
              .map((value) => value.toString())
              .join('\n')
          : (error?.message ?? ''),
      )
        .replaceAll(process.env.DEEPSEEK_API_KEY, '[redacted]')
        .slice(0, 1200),
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.close();
  rmSync(directory, { recursive: true, force: true });
}
