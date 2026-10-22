import { storageFor, contextFor } from './stage-storage.js';
import { commitGeneration } from './execution-context.js';
import type { PrismaService } from '../prisma.service.js';
import { Injectable } from '@nestjs/common';
import { Stage, StageContext } from '@rill/shared';
import { QuestionnaireAnswers } from '@rill/shared';

export type StaleUpdater = (projectId: string, stale: boolean) => Promise<void>;

export interface StageGenerator<T = unknown> {
  readonly stage: Stage;
  /** 声明依赖哪些上游阶段（按问卷答案动态决定，如跳过世界观的类型不依赖 world） */
  readonly requires: (answers: QuestionnaireAnswers) => Stage[];
  generate(context: StageContext, answers: QuestionnaireAnswers, projectId: string): Promise<T>;
}

/**
 * 阶段产物与生成器注册表：
 * - 登记「阶段 → 产物失效操作」，使流水线的回退/失效机制不依赖具体产物表
 * - 登记「阶段 → 生成器 + 上游依赖声明」，使上游装配集中在一处
 */
@Injectable()
export class ArtifactRegistry {
  private readonly updaters = new Map<Stage, StaleUpdater>();
  private readonly generators = new Map<Stage, StageGenerator>();

  register(stage: Stage, updater: StaleUpdater): void {
    this.updaters.set(stage, updater);
  }

  registerGenerator(generator: StageGenerator): void {
    this.generators.set(generator.stage, generator);
  }

  definition(stage: Stage) {
    return {
      storage: storageFor(stage),
      generator: this.generators.get(stage),
      invalidate: this.updaters.get(stage),
    };
  }

  registerStorage(stage: Stage, prisma: PrismaService): void {
    this.register(stage, async (projectId, stale) => {
      await commitGeneration(prisma, async (tx) => {
        await tx.stageRun.updateMany({ where: { projectId, stage }, data: { stale } });
        await storageFor(stage)?.invalidate(tx, projectId, stale);
      });
    });
  }

  context = contextFor;

  getGenerator(stage: Stage): StageGenerator | undefined {
    return this.generators.get(stage);
  }

  has(stage: Stage): boolean {
    return this.updaters.has(stage);
  }

  async setStale(stage: Stage, projectId: string, stale: boolean): Promise<void> {
    const updater = this.updaters.get(stage);
    if (updater) {
      await updater(projectId, stale);
    }
  }
}
