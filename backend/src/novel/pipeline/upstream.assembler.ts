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
      include: { premise: true, world: true, characters: true, relations: true },
    });
    if (!project) throw new NotFoundException(`项目不存在: ${projectId}`);

    const generator = this.artifacts.getGenerator(targetStage);
    const answers = JSON.parse(project.answers) as QuestionnaireAnswers;
    const requires = generator?.requires(answers) ?? [];

    for (const stage of requires) {
      const state = this.readStageState(project, stage);
      if (!state || state.status !== 'done') {
        throw new BadRequestException(`上游阶段 ${stage} 尚未完成，请先完成该阶段`);
      }
      if (state.stale) {
        throw new BadRequestException(`上游阶段 ${stage} 已失效，请先重新生成该阶段`);
      }
    }

    const context: StageContext = {};
    if (project.premise && project.premise.status === 'done' && !project.premise.stale) {
      context.premise = JSON.parse(project.premise.data);
    }
    if (project.world && project.world.status === 'done' && !project.world.stale) {
      context.world = JSON.parse(project.world.data);
    }
    const characters = project.characters.filter((item) => item.status === 'done' && !item.stale);
    if (characters.length > 0) {
      context.characters = characters.map((item) => JSON.parse(item.data));
    }

    return context;
  }

  /** 读取某阶段的聚合状态（1:1 产物直接读；1:N 产物按行聚合） */
  readStageState(
    project: {
      premise?: { status: string; stale: boolean } | null;
      world?: { status: string; stale: boolean } | null;
      characters?: Array<{ status: string; stale: boolean }>;
      relations?: Array<{ status: string; stale: boolean }>;
    },
    stage: Stage,
  ): StageState | undefined {
    if (stage === 'premise') {
      return project.premise
        ? { status: project.premise.status as ArtifactStatus, stale: project.premise.stale }
        : undefined;
    }
    if (stage === 'world') {
      return project.world
        ? { status: project.world.status as ArtifactStatus, stale: project.world.stale }
        : undefined;
    }
    if (stage === 'characters') {
      return this.aggregate(project.characters ?? []);
    }
    if (stage === 'relations') {
      return this.aggregate(project.relations ?? []);
    }
    return undefined;
  }

  /**
   * 聚合 1:N 产物的阶段状态。
   * stale 与 status 是两个独立维度：stale 表示「上游变动后需重新生成」，
   * status 表示「产物本身的生成结果」，二者不再互相映射。
   */
  private aggregate(rows: Array<{ status: string; stale: boolean }>): StageState | undefined {
    if (rows.length === 0) return undefined;
    const anyStale = rows.some((row) => row.stale);
    const allDone = rows.every((row) => row.status === 'done');
    const anyFailed = rows.some((row) => row.status === 'failed');

    let status: ArtifactStatus;
    if (allDone) {
      status = 'done';
    } else if (anyFailed) {
      status = 'failed';
    } else {
      // 存在 pending 或混合状态：视作仍在推进中
      status = 'generating';
    }

    return { status, stale: anyStale };
  }

  parseAnswers(answers: string): QuestionnaireAnswers {
    return JSON.parse(answers) as QuestionnaireAnswers;
  }
}
