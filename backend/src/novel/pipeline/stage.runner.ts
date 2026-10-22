import { storageFor } from './stage-storage.js';
import { commitGeneration, executionContext } from './execution-context.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ArtifactStatus, QuestionnaireAnswers, Stage } from '@rill/shared';
import { PrismaService } from '../prisma.service.js';
import { stagesFor } from '../genre/genre-profile.js';
import { ArtifactRegistry } from './artifact.registry.js';
import { UpstreamAssembler } from './upstream.assembler.js';
import { PipelineState, StageRunner } from './pipeline.graph.js';

export interface StageRunnerDeps {
  prisma: PrismaService;
  assembler: UpstreamAssembler;
  artifacts: ArtifactRegistry;
}

/** 阶段产物状态推进（覆盖 1:1 与 1:N 两类产物） */
export async function setStageStatus(
  prisma: PrismaService,
  projectId: string,
  stage: Stage,
  status: ArtifactStatus,
  error?: string,
): Promise<void> {
  await commitGeneration(prisma, async (tx) => {
    executionContext.getStore()?.signal.throwIfAborted();
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    const runId = project.runId ?? 'legacy';
    await tx.stageRun.upsert({
      where: { projectId_runId_stage: { projectId, runId, stage } },
      create: { projectId, runId, stage, status, error: error ?? null },
      update: { status, error: error ?? null, ...(status === 'done' ? { stale: false } : {}) },
    });
    await storageFor(stage)?.write(tx, projectId, { status, error: error ?? null });
  });
}

/** 重新生成某阶段时，其下游产物一律标记失效 */
export async function markDownstreamStale(
  artifacts: ArtifactRegistry,
  projectId: string,
  targetStage: Stage,
  genre: QuestionnaireAnswers['genre'],
): Promise<void> {
  const stages = stagesFor(genre);
  const targetIndex = stages.indexOf(targetStage);
  for (const stage of stages.slice(targetIndex + 1)) {
    await artifacts.setStale(stage, projectId, true);
  }
}

/**
 * 阶段节点的执行体：
 * 幂等检查 → 标记下游失效 → 置 generating → 装配上游 → 生成 → 置 done。
 * 失败时置 failed 并抛出，使图停在失败阶段（currentStage 不推进），
 * 再次恢复即从该阶段继续。
 */
export function createStageRunner(deps: StageRunnerDeps): StageRunner {
  return async (state: PipelineState, stage: Stage) => {
    executionContext.getStore()?.signal.throwIfAborted();
    const project = await deps.prisma.project.findUnique({
      where: { id: state.projectId },
      include: {
        premise: true,
        world: true,
        characters: true,
        relations: true,
        stageRuns: { orderBy: { updatedAt: 'desc' } },
      },
    });
    if (!project) throw new NotFoundException(`项目不存在: ${state.projectId}`);

    // 幂等：已生效（完成且未失效）的产物不重复生成，避免重复调用模型
    const stageState = deps.assembler.readStageState(project, stage);
    if (stageState?.status === 'done' && !stageState.stale) return { currentStage: stage };

    // 记录正在处理的阶段：失败时也停在该阶段，续跑不会退回上一阶段
    await commitGeneration(deps.prisma, async (tx) => {
      await tx.project.update({ where: { id: state.projectId }, data: { currentStage: stage } });
    });

    const generator = deps.artifacts.getGenerator(stage);
    if (!generator) {
      const message = `阶段 ${stage} 的生成能力尚未实现（留给后续 change）`;
      await setStageStatus(deps.prisma, state.projectId, stage, 'failed', message);
      throw new BadRequestException(message);
    }

    await markDownstreamStale(deps.artifacts, state.projectId, stage, state.answers.genre);
    await setStageStatus(deps.prisma, state.projectId, stage, 'generating');

    try {
      const context = await deps.assembler.assemble(state.projectId, stage);
      await generator.generate(context, state.answers, state.projectId);
      await setStageStatus(deps.prisma, state.projectId, stage, 'done');
      return { currentStage: stage };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStageStatus(deps.prisma, state.projectId, stage, 'failed', message);
      throw error;
    }
  };
}
