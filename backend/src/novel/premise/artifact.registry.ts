import { Injectable } from '@nestjs/common';
import { Stage } from '@rill/shared';

export type StaleUpdater = (projectId: string, stale: boolean) => Promise<void>;

/**
 * 阶段产物注册表：把「阶段 → 产物失效操作」解耦出来，
 * 使流水线的回退/失效机制不依赖具体产物表，后续阶段只需注册自己的 updater。
 */
@Injectable()
export class ArtifactRegistry {
  private readonly updaters = new Map<Stage, StaleUpdater>();

  register(stage: Stage, updater: StaleUpdater): void {
    this.updaters.set(stage, updater);
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
