import { storageFor } from './stage-storage.js';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ArtifactStatus, QuestionnaireAnswers, Stage, StageContext } from '@rill/shared';
import { PrismaService } from '../prisma.service.js';
import { ArtifactRegistry } from './artifact.registry.js';

export interface StageState {
  status: ArtifactStatus;
  stale: boolean;
}

/**
 * 上游产物装配：由流水线统一查库、过滤未确认与失效产物，
 * 生成器不再自行查询，只消费装配好的上下文。
 */
@Injectable()
export class UpstreamAssembler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactRegistry,
  ) {}

  async assemble(projectId: string, targetStage: Stage): Promise<StageContext> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        outline: { include: { batches: true } },
        premise: true,
        world: true,
        characters: true,
        relations: true,
        stageRuns: { orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }] },
      },
    });
    if (!project) throw new NotFoundException(`项目不存在: ${projectId}`);

    const generator = this.artifacts.getGenerator(targetStage);
    const answers = JSON.parse(project.answers) as QuestionnaireAnswers;
    if (answers.length !== 'short')
      throw new BadRequestException('当前仅支持短篇小说，历史项目可查看，请新建短篇项目继续创作');
    const requires =
      generator?.requires(answers) ?? (targetStage === 'prose' ? ['outline' as Stage] : []);

    for (const stage of requires) {
      const state = this.readStageState(project, stage);
      if (!state || state.status !== 'done') {
        throw new BadRequestException(`上游阶段 ${stage} 尚未完成，请先完成该阶段`);
      }
      if (
        stage === 'outline' &&
        (!project.outline || project.outline.confirmedRevision !== project.outline.revision)
      ) {
        throw new BadRequestException('上游阶段 outline 尚未确认完整大纲');
      }
      if (state.stale) {
        throw new BadRequestException(`上游阶段 ${stage} 已失效，请先重新生成该阶段`);
      }
    }

    const context = this.artifacts.context(project);
    if (
      targetStage === 'prose' &&
      (!context.outline ||
        context.outline.chapters.length !== project.outline?.targetChapters ||
        context.outline.chapters.some((c, i) => c.number !== i + 1))
    ) {
      throw new BadRequestException('完整大纲章节缺失或章号不连续，请先修复大纲');
    }
    return context;
  }

  /** 读取某阶段的聚合状态（1:1 产物直接读；1:N 产物按行聚合） */
  readStageState(
    project: {
      stageRuns?: Array<{ stage: string; status: string; stale: boolean }>;
      premise?: { status: string; stale: boolean } | null;
      world?: { status: string; stale: boolean } | null;
      characters?: Array<{ status: string; stale: boolean }>;
      relations?: Array<{ status: string; stale: boolean }>;
    },
    stage: Stage,
  ): StageState | undefined {
    const execution = project.stageRuns?.find((run) => run.stage === stage);
    const rows = storageFor(stage)?.rows(project) ?? [];
    const legacyRows = rows;
    const legacy =
      legacyRows.length === 0
        ? undefined
        : {
            status: legacyRows.every((row) => row.status === 'done')
              ? 'done'
              : legacyRows.some((row) => row.status === 'failed')
                ? 'failed'
                : legacyRows.some((row) => row.status === 'generating')
                  ? 'generating'
                  : 'pending',
            stale: legacyRows.some((row) => row.stale),
          };
    return execution
      ? {
          status: execution.status as ArtifactStatus,
          stale: execution.stale || legacy?.stale === true,
        }
      : (legacy as StageState | undefined);
  }

  parseAnswers(answers: string): QuestionnaireAnswers {
    return JSON.parse(answers) as QuestionnaireAnswers;
  }
}
