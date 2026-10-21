import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArtifactStatus, PipelineMode, QuestionnaireAnswers, Stage } from '@rill/shared';
import { PrismaService } from '../prisma.service';
import { stagesFor } from '../genre/genre-profile';
import { MissingRequiredAnswersError, QuestionnaireService } from '../questionnaire/questionnaire';
import { PremiseGenerator } from '../premise/premise.generator';
import { ArtifactRegistry } from '../premise/artifact.registry';

export interface CreateProjectInput {
  title: string;
  answers: QuestionnaireAnswers;
  mode?: PipelineMode;
}

@Injectable()
export class PipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questionnaire: QuestionnaireService,
    private readonly premiseGenerator: PremiseGenerator,
    private readonly artifacts: ArtifactRegistry,
  ) {}

  async create(input: CreateProjectInput) {
    try {
      this.questionnaire.validate(input.answers);
    } catch (error) {
      if (error instanceof MissingRequiredAnswersError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    const stages = stagesFor(input.answers.genre);

    return this.prisma.project.create({
      data: {
        title: input.title,
        genre: input.answers.genre,
        length: input.answers.length,
        mode: input.mode ?? 'manual',
        currentStage: stages[0],
        status: 'idle',
        answers: JSON.stringify(input.answers),
        premise: { create: { data: '{}', status: 'pending' } },
      },
    });
  }

  async get(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { premise: true },
    });
    if (!project) throw new NotFoundException(`项目不存在: ${id}`);
    return project;
  }

  /**
   * 触发生成：立即返回（阶段进入 generating），生成在后台推进。
   * 并发防护：generating 中拒绝；已 done 且未强制时直接返回已有产物。
   */
  async generate(id: string, options: { force?: boolean; wait?: boolean } = {}) {
    const project = await this.get(id);
    const stage = project.currentStage as Stage;

    if (stage === 'premise') {
      if (project.premise?.status === 'generating') {
        throw new ConflictException('该阶段正在生成中，请勿重复触发');
      }
      if (project.premise?.status === 'done' && !options.force) {
        return { stage, status: project.premise.status as ArtifactStatus, started: false };
      }
    }

    await this.setArtifactStatus(id, stage, 'generating');
    await this.prisma.project.update({ where: { id }, data: { status: 'running' } });

    const task = this.runGeneration(project, stage);
    if (options.wait) {
      // 等待时把失败抛给调用方（自动模式据此停止）
      await task;
    } else {
      // 后台执行：失败已写入产物与项目状态，这里只避免未处理的 rejection
      void task.catch(() => undefined);
    }

    return { stage, status: 'generating' as ArtifactStatus, started: true };
  }

  /** 手动模式：确认当前阶段后推进到下一阶段 */
  async confirm(id: string) {
    const project = await this.get(id);
    const stage = project.currentStage as Stage;

    if (stage === 'premise' && project.premise?.status !== 'done') {
      throw new BadRequestException('当前阶段产物尚未生成完成，无法确认');
    }

    const stages = stagesFor(project.genre as QuestionnaireAnswers['genre']);
    const index = stages.indexOf(stage);
    const next = stages[index + 1];

    await this.prisma.project.update({
      where: { id },
      data: { currentStage: next ?? stage, status: next ? 'idle' : 'done' },
    });
    return this.get(id);
  }

  /** 回退到指定阶段，并把其之后的阶段产物标记为失效 */
  async rollback(id: string, stage: Stage) {
    const project = await this.get(id);
    const stages = stagesFor(project.genre as QuestionnaireAnswers['genre']);
    if (!stages.includes(stage)) {
      throw new BadRequestException(`该类型不支持阶段: ${stage}`);
    }

    await this.markDownstreamStale(id, stage, project.genre as QuestionnaireAnswers['genre']);
    await this.prisma.project.update({
      where: { id },
      data: { currentStage: stage, status: 'idle' },
    });
    return this.get(id);
  }

  async setMode(id: string, mode: PipelineMode) {
    await this.get(id);
    await this.prisma.project.update({ where: { id }, data: { mode } });
    return this.get(id);
  }

  /** 自动模式：连续推进；失败停在该阶段，再次启动从失败阶段继续 */
  async runAuto(id: string) {
    const project = await this.get(id);
    const stages = stagesFor(project.genre as QuestionnaireAnswers['genre']);
    const startIndex = stages.indexOf(project.currentStage as Stage);

    for (const stage of stages.slice(startIndex)) {
      await this.prisma.project.update({ where: { id }, data: { currentStage: stage } });
      try {
        await this.generate(id, { wait: true });
      } catch (error) {
        await this.prisma.project.update({ where: { id }, data: { status: 'failed' } });
        throw error;
      }
    }
    await this.prisma.project.update({ where: { id }, data: { status: 'done' } });
    return this.get(id);
  }

  private async runGeneration(
    project: { id: string; genre: string; answers: string },
    stage: Stage,
  ): Promise<void> {
    try {
      if (stage === 'premise') {
        await this.premiseGenerator.generate(project);
      } else {
        throw new Error(`阶段 ${stage} 的生成能力尚未实现（留给后续 change）`);
      }
      // 状态由流水线统一推进，生成器只负责写产物数据与用量
      await this.setArtifactStatus(project.id, stage, 'done');
      await this.prisma.project.update({ where: { id: project.id }, data: { status: 'idle' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.setArtifactStatus(project.id, stage, 'failed', message);
      await this.prisma.project.update({ where: { id: project.id }, data: { status: 'failed' } });
      // 重新抛出，让等待方（自动模式）感知失败并停止推进
      throw error;
    }
  }

  private async setArtifactStatus(
    projectId: string,
    stage: Stage,
    status: ArtifactStatus,
    error?: string,
  ): Promise<void> {
    if (stage === 'premise') {
      await this.prisma.premise.update({
        where: { projectId },
        data: { status, error: error ?? null },
      });
    }
  }

  private async markDownstreamStale(
    projectId: string,
    targetStage: Stage,
    genre: QuestionnaireAnswers['genre'],
  ): Promise<void> {
    const stages = stagesFor(genre);
    const targetIndex = stages.indexOf(targetStage);
    for (const stage of stages.slice(targetIndex + 1)) {
      await this.artifacts.setStale(stage, projectId, true);
    }
  }
}
