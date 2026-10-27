import { renderWritingStyle } from '../writing-style/writing-style.registry.js';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  PremiseReadSchema,
  RevisedPremiseOutputSchema,
  type RevisedPremiseOutput,
  type PremiseChangeSummary,
  PremiseSchema,
  PreviewPremiseBodySchema,
  QuestionnaireAnswersSchema,
  type GeneratedPremise,
  type PremisePreview,
  type PreviewPremiseBody,
} from '@rill/shared';
import { LlmService } from '../../ai/llm.service.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { UsageRecorder } from '../../ai/observability/usage-recorder.js';
import { newTraceId } from '../../ai/observability/trace.js';
import { PrismaService } from '../prisma.service.js';
import { PipelineService } from '../pipeline/pipeline.service.js';
import { acquireProjectRun } from '../pipeline/project-run.js';
import { invalidateDownstreamInTransaction } from '../pipeline/stage.runner.js';
import { profileFor } from '../genre/genre-profile.js';
import { buildPremiseChangeSummary, readPremiseChangeSummary } from './premise-change-summary.js';
import { resolvePremiseTitle } from './title-policy.js';
import { premiseRevisionV4 } from '../prompts/premise-revision-template.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class PremiseRevisionService {
  /** 总体兜底包含结构修复与重试；超时后忽略迟到结果。 */
  private readonly previewTimeoutMs = 10 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly prompts: PromptRegistry,
    private readonly usage: UsageRecorder,
    private readonly pipeline: PipelineService,
  ) {
    this.prompts.register(premiseRevisionV4);
  }

  private async project(id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: { premise: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.status === 'running' || project.runId)
      throw new ConflictException('项目正在运行，请稍后再修改种子');
    return project;
  }

  async preview(id: string, input: PreviewPremiseBody): Promise<PremisePreview> {
    const body = PreviewPremiseBodySchema.parse(input);
    const project = await this.project(id);
    const previous = await this.prisma.premiseRevision.findUnique({
      where: { projectId_requestId: { projectId: id, requestId: body.requestId } },
    });
    if (previous) {
      if (previous.feedback !== body.feedback)
        throw new ConflictException('请求标识已用于不同建议，请重新提交');
      if (previous.status === 'done' && previous.data)
        return {
          candidateId: previous.id,
          ...readPremiseChangeSummary(previous.changeSummaryData),
          premise: PremiseSchema.parse(JSON.parse(previous.data)),
        };
      throw new ConflictException(previous.error ?? '修改预览正在生成，请稍候');
    }
    if (project.length !== 'short')
      throw new BadRequestException('当前仅支持短篇小说，历史项目可查看，请新建短篇项目继续创作');
    const formal = project.premise;
    if (!formal || formal.status !== 'done' || formal.stale)
      throw new BadRequestException('请先生成有效的正式种子');
    const parsed = PremiseReadSchema.safeParse(JSON.parse(formal.data));
    if (!parsed.success) throw new BadRequestException('正式种子内容无效，请先重新生成');
    const answers = QuestionnaireAnswersSchema.parse(JSON.parse(project.answers));
    const prompt = this.prompts.render('premise-revision', 'v4', {
      writingStyle: renderWritingStyle(answers.writingStyle, 'premise'),
      title: project.title,
      titleSource: project.titleSource,
      answers: JSON.stringify(answers),
      premise: JSON.stringify(parsed.data),
      feedback: body.feedback,
      genreTraits: profileFor(answers.genre).traits.join('、'),
    });
    const revision = await this.prisma.$transaction(async (tx) => {
      const runId = await acquireProjectRun(tx, project);
      return tx.premiseRevision.create({
        data: {
          projectId: id,
          requestId: body.requestId,
          feedback: body.feedback,
          baseHash: hash(formal.data),
          runId,
          originalStatus: project.status,
        },
      });
    });
    const traceId = newTraceId();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let candidate: GeneratedPremise | undefined;
    let changeSummary: PremiseChangeSummary | undefined;
    let failure: string | undefined;
    try {
      const output = RevisedPremiseOutputSchema.parse(
        await Promise.race([
          this.llm.completeStructured<RevisedPremiseOutput>(
            RevisedPremiseOutputSchema,
            [{ role: 'user', content: prompt }],
            { traceId, signal: controller.signal },
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error('修改预览生成超时，请重试'));
            }, this.previewTimeoutMs);
          }),
        ]),
      );
      candidate = resolvePremiseTitle(project, output.premise).premise;
      changeSummary = buildPremiseChangeSummary(parsed.data, candidate, output.changeNotes);
    } catch (error) {
      candidate = undefined;
      changeSummary = undefined;
      failure = error instanceof Error ? error.message : '修改预览生成失败，请重试';
    } finally {
      if (timer) clearTimeout(timer);
    }
    const tokens = this.usage.get(traceId);
    await this.prisma
      .$transaction(async (tx) => {
        const owned = await tx.project.updateMany({
          where: { id, runId: revision.runId, status: 'running', deletedAt: null },
          data: { runId: revision.runId },
        });
        if (owned.count !== 1) throw new ConflictException('运行已失效，拒绝提交旧预览');
        await tx.premiseRevision.update({
          where: { id: revision.id },
          data: {
            status: failure ? 'failed' : 'done',
            error: failure ?? null,
            data: candidate ? JSON.stringify(candidate) : null,
            changeSummaryData: changeSummary ? JSON.stringify(changeSummary) : null,
            promptTokens: tokens?.promptTokens ?? 0,
            completionTokens: tokens?.completionTokens ?? 0,
          },
        });
        await tx.project.update({
          where: { id },
          data: {
            status: project.status,
            runId: null,
            promptTokens: { increment: tokens?.promptTokens ?? 0 },
            completionTokens: { increment: tokens?.completionTokens ?? 0 },
          },
        });
      })
      .catch(async (error: unknown) => {
        // 持久化失败时仅释放自己的锁，不触碰已经接管的新任务。
        await this.prisma.project.updateMany({
          where: { id, runId: revision.runId, deletedAt: null },
          data: { status: project.status, runId: null },
        });
        throw error;
      });
    if (failure || !candidate || !changeSummary)
      throw new BadGatewayException(failure ?? '修改预览生成失败');
    return { candidateId: revision.id, premise: candidate, changeSummary };
  }

  async adopt(id: string, candidateId: string) {
    const project = await this.project(id);
    const candidate = await this.prisma.premiseRevision.findFirst({
      where: { id: candidateId, projectId: id },
    });
    if (!candidate) throw new NotFoundException('候选不存在');
    if (candidate.adoptedAt) return this.pipeline.get(id);
    if (candidate.status !== 'done' || !candidate.data)
      throw new BadRequestException('候选尚未生成成功');
    const resolved = resolvePremiseTitle(project, PremiseSchema.parse(JSON.parse(candidate.data)));
    const premise = resolved.premise;
    if (
      !project.premise ||
      project.premise.stale ||
      project.premise.status !== 'done' ||
      candidate.baseHash !== hash(project.premise.data)
    )
      throw new ConflictException('正式种子已经变化，请重新生成修改预览');
    const runId = await acquireProjectRun(this.prisma, project);
    try {
      await this.pipeline.clearPremiseCheckpoint(id);
      await this.prisma.$transaction(async (tx) => {
        const owned = await tx.project.updateMany({
          where: { id, runId, deletedAt: null, status: 'running' },
          data: { runId },
        });
        if (owned.count !== 1) throw new ConflictException('运行已失效，拒绝采用');
        const formal = await tx.premise.findUniqueOrThrow({ where: { projectId: id } });
        if (hash(formal.data) !== candidate.baseHash)
          throw new ConflictException('正式种子已经变化，请重新生成修改预览');
        await tx.premise.update({
          where: { projectId: id },
          data: {
            data: JSON.stringify(premise),
            status: 'done',
            stale: false,
            error: null,
          },
        });
        await tx.stageRun.updateMany({
          where: { projectId: id, stage: 'premise' },
          data: { stale: true, confirmedAt: null },
        });
        await tx.stageRun.create({
          data: { projectId: id, runId, stage: 'premise', status: 'done' },
        });
        await invalidateDownstreamInTransaction(
          tx,
          id,
          'premise',
          QuestionnaireAnswersSchema.parse(JSON.parse(project.answers)).genre,
        );
        await tx.premiseRevision.update({
          where: { id: candidateId },
          data: { adoptedAt: new Date() },
        });
        await tx.project.update({
          where: { id },
          data: { ...resolved.project, currentStage: 'premise', status: 'idle', runId: null },
        });
      });
    } finally {
      await this.prisma.project.updateMany({
        where: { id, runId, deletedAt: null },
        data: { status: project.status, runId: null },
      });
    }
    return this.pipeline.get(id);
  }
}
