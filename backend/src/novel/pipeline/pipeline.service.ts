import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ArtifactStatus, PipelineMode, QuestionnaireAnswers, Stage } from '@rill/shared';
import { PrismaService } from '../prisma.service';
import { stagesFor } from '../genre/genre-profile';
import { MissingRequiredAnswersError, QuestionnaireService } from '../questionnaire/questionnaire';
import { ArtifactRegistry } from './artifact.registry';
import { UpstreamAssembler } from './upstream.assembler';

export interface CreateProjectInput {
  title: string;
  answers: QuestionnaireAnswers;
  mode?: PipelineMode;
}

/**
 * 后台生成的总体超时。模型自身有单次请求超时，但图执行级别的挂起
 * （如连接半开）不会抛错，需要这层兜底把项目从 running 中解救出来。
 */
const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;

const TIMEOUT_MARK = Symbol('generation-timeout');

@Injectable()
export class PipelineService implements OnModuleInit {
  private readonly logger = new Logger(PipelineService.name);
  /** 可被测试覆盖，以便用极小值验证超时路径 */
  private readonly generationTimeoutMs: number = GENERATION_TIMEOUT_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly questionnaire: QuestionnaireService,
    private readonly artifacts: ArtifactRegistry,
    private readonly assembler: UpstreamAssembler,
  ) {}

  async onModuleInit(): Promise<void> {
    // 重启时把被中断的生成任务标记为失败，避免项目永久卡在 running 状态
    const result = await this.prisma.project.updateMany({
      where: { status: 'running' },
      data: { status: 'failed' },
    });
    if (result.count > 0) {
      this.logger.warn(`重启时重置了 ${result.count} 个被中断的生成任务为失败状态`);
    }
  }

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
      include: { premise: true, world: true, characters: true, relations: true },
    });
    if (!project) throw new NotFoundException(`项目不存在: ${id}`);
    return project;
  }

  /**
   * 触发生成：立即返回（阶段进入 generating），生成在后台推进。
   * 并发防护：项目级 running 锁；已 done 且未强制时直接返回已有产物。
   */
  async generate(id: string, options: { force?: boolean; wait?: boolean } = {}) {
    const project = await this.get(id);
    const stage = project.currentStage as Stage;
    const answers = JSON.parse(project.answers) as QuestionnaireAnswers;

    const generator = this.artifacts.getGenerator(stage);
    if (!generator) {
      throw new BadRequestException(`阶段 ${stage} 的生成能力尚未实现（留给后续 change）`);
    }

    if (project.status === 'running') {
      throw new ConflictException('该项目有生成任务正在进行，请勿重复触发');
    }

    const artifactState = this.assembler.readStageState(project, stage);
    // 已生效（完成且未失效）的产物不重复生成；失效或未完成则重新生成
    if (artifactState?.status === 'done' && !artifactState.stale && !options.force) {
      return { stage, status: artifactState.status, started: false };
    }

    // 装配上游产物（上游未完成或失效时抛错）
    const context = await this.assembler.assemble(id, stage);

    // 重新生成某阶段时，其下游产物一律标记失效（如重生成人物 → 关系失效）
    await this.markDownstreamStale(id, stage, answers.genre);

    await this.setStageStatus(id, stage, 'generating');
    await this.prisma.project.update({ where: { id }, data: { status: 'running' } });

    const task = this.runGenerationWithTimeout(id, stage, generator, context, answers);
    if (options.wait) {
      await task;
    } else {
      void task.catch(() => undefined);
    }

    return { stage, status: 'generating' as ArtifactStatus, started: true };
  }

  /** 手动模式：确认当前阶段后推进到下一阶段 */
  async confirm(id: string) {
    const project = await this.get(id);
    const stage = project.currentStage as Stage;

    const state = this.assembler.readStageState(project, stage);
    if (!state || state.status !== 'done') {
      throw new BadRequestException('当前阶段产物尚未生成完成，无法确认');
    }
    if (state.stale) {
      throw new BadRequestException('当前阶段产物已失效，请先重新生成后再确认');
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

  /** 查询项目的人物列表（含状态） */
  async characters(id: string) {
    await this.get(id);
    return this.prisma.character.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 查询项目的关系列表（含双方标识、类型与相对角色） */
  async relations(id: string) {
    await this.get(id);
    return this.prisma.relation.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    });
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

  /**
   * 带总体超时的生成执行。超时后主动把阶段与项目标记为失败，
   * 避免后台任务挂起导致项目永久停在 running（后续操作全被拒绝）。
   */
  private async runGenerationWithTimeout(
    projectId: string,
    stage: Stage,
    generator: { generate: (...args: unknown[]) => Promise<unknown> },
    context: Parameters<typeof generator.generate>[0],
    answers: QuestionnaireAnswers,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMEOUT_MARK>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT_MARK), this.generationTimeoutMs);
      // 不因定时器未决而阻止进程退出
      timer.unref?.();
    });

    try {
      const outcome = await Promise.race([
        this.runGeneration(projectId, stage, generator, context, answers).then(
          () => 'settled' as const,
        ),
        timeout,
      ]);

      if (outcome === TIMEOUT_MARK) {
        const message = `生成超时（超过 ${Math.round(this.generationTimeoutMs / 60000)} 分钟），已中止并标记失败`;
        await this.setStageStatus(projectId, stage, 'failed', message);
        await this.prisma.project.update({ where: { id: projectId }, data: { status: 'failed' } });
        throw new Error(message);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async runGeneration(
    projectId: string,
    stage: Stage,
    generator: { generate: (...args: unknown[]) => Promise<unknown> },
    context: Parameters<typeof generator.generate>[0],
    answers: QuestionnaireAnswers,
  ): Promise<void> {
    try {
      await generator.generate(context, answers, projectId);
      // 状态由流水线统一推进，生成器只写产物数据与用量
      await this.setStageStatus(projectId, stage, 'done');
      await this.prisma.project.update({ where: { id: projectId }, data: { status: 'idle' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.setStageStatus(projectId, stage, 'failed', message);
      await this.prisma.project.update({ where: { id: projectId }, data: { status: 'failed' } });
      // 重新抛出，让等待方（自动模式）感知失败并停止推进
      throw error;
    }
  }

  /** 阶段产物状态推进（覆盖 1:1 与 1:N 两类产物） */
  private async setStageStatus(
    projectId: string,
    stage: Stage,
    status: ArtifactStatus,
    error?: string,
  ): Promise<void> {
    const data = { status, error: error ?? null };
    if (stage === 'premise') {
      await this.prisma.premise.updateMany({ where: { projectId }, data });
    } else if (stage === 'world') {
      await this.prisma.worldSetting.updateMany({ where: { projectId }, data });
    } else if (stage === 'characters') {
      await this.prisma.character.updateMany({ where: { projectId }, data });
    } else if (stage === 'relations') {
      await this.prisma.relation.updateMany({ where: { projectId }, data });
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
