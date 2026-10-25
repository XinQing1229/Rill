import { ProseRevisionService } from './prose/prose-revision.service.js';
import {
  CreateProseRevisionBodySchema,
  ApplyProseRevisionBodySchema,
  type CreateProseRevisionBody,
  type ApplyProseRevisionBody,
} from '@rill/shared';
import { PremiseRevisionService } from './premise/premise-revision.service.js';
import {
  PreviewPremiseBodySchema,
  AdoptPremiseBodySchema,
  type PreviewPremiseBody,
  type AdoptPremiseBody,
} from '@rill/shared';
import { ProseService } from './prose/prose.service.js';
import {
  ConfirmProseBodySchema,
  ProseChapterParamSchema,
  OverrideProseReviewBodySchema,
  type ConfirmProseBody,
  type OverrideProseReviewBody,
} from '@rill/shared';
import {
  BadRequestException,
  GoneException,
  HttpCode,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Patch,
} from '@nestjs/common';
import {
  ConfirmAction,
  OutlineConfigBodySchema,
  OutlinePlanBodySchema,
  OutlineChapterBodySchema,
  type OutlineConfirm,
  type OutlinePlan,
  type ChapterSummary,
  ConfirmBodySchema,
  CreateProjectSchema,
  GENRES,
  GenerateBodySchema,
  Genre,
  RollbackBodySchema,
  SetModeBodySchema,
  ProjectScopeSchema,
  type ProjectScope,
} from '@rill/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { OutlineService } from './outline/outline.service.js';
import { PipelineService } from './pipeline/pipeline.service.js';
import { QuestionnaireService } from './questionnaire/questionnaire.js';

@Controller('novel')
export class NovelController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly questionnaire: QuestionnaireService,
    private readonly outline: OutlineService,
    private readonly prose: ProseService,
    private readonly proseRevision: ProseRevisionService,
    private readonly premiseRevision: PremiseRevisionService,
  ) {}

  @Post('projects/:id/premise/preview')
  previewPremise(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PreviewPremiseBodySchema)) body: PreviewPremiseBody,
  ) {
    return this.premiseRevision.preview(id, body);
  }

  @Post('projects/:id/premise/adopt')
  adoptPremise(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdoptPremiseBodySchema)) body: AdoptPremiseBody,
  ) {
    return this.premiseRevision.adopt(id, body.candidateId);
  }

  /** 获取问卷结构（随类型级联） */
  @Get('questionnaire')
  getQuestionnaire(@Query('genre') genre: string) {
    const valid = GENRES.find((item) => item === genre);
    if (!valid) {
      throw new NotFoundException(`未知类型: ${genre}，可用: ${GENRES.join(', ')}`);
    }
    return this.questionnaire.build(valid as Genre);
  }

  @Post('projects')
  create(@Body(new ZodValidationPipe(CreateProjectSchema)) body: unknown) {
    return this.pipeline.create(body as Parameters<PipelineService['create']>[0]);
  }

  /** 项目列表（列表页用）：默认创作中，scope=trash 为回收站 */
  @Get('projects')
  list(
    @Query('scope', new ZodValidationPipe(ProjectScopeSchema)) scope?: ProjectScope | undefined,
  ) {
    return this.pipeline.list(scope ?? 'active');
  }

  /** 软删除：移入回收站，产物保留可恢复 */
  @Delete('projects/:id')
  softDelete(@Param('id') id: string) {
    return this.pipeline.softDelete(id);
  }

  /** 从回收站恢复 */
  @Post('projects/:id/restore')
  restore(@Param('id') id: string) {
    return this.pipeline.restore(id);
  }

  /** 永久删除单个回收站项目（不可恢复） */
  @Delete('projects/:id/permanent')
  purge(@Param('id') id: string) {
    return this.pipeline.purge(id);
  }

  /** 清空回收站：scope=trash 才允许，避免误触发全量删除 */
  @Delete('projects')
  clearTrash(
    @Query('scope', new ZodValidationPipe(ProjectScopeSchema)) scope?: ProjectScope | undefined,
  ) {
    if (scope !== 'trash') throw new BadRequestException('清空回收站必须指定 scope=trash');
    return this.pipeline.clearTrash();
  }

  @Get('projects/:id')
  get(@Param('id') id: string) {
    return this.pipeline.get(id);
  }

  /** 触发生成：立即返回，状态由流水线推进 */
  @Post('projects/:id/generate')
  generate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(GenerateBodySchema)) body: unknown,
  ) {
    return this.pipeline.generate(id, body as { force?: boolean; wait?: boolean });
  }

  /** 确认推进或重新生成本阶段：由流水线图从中断处恢复执行 */
  @Post('projects/:id/confirm')
  confirm(@Param('id') id: string, @Body(new ZodValidationPipe(ConfirmBodySchema)) body: unknown) {
    const { action, target, expectedRevision } = body as {
      action?: ConfirmAction;
    } & Partial<OutlineConfirm>;
    if (target && expectedRevision === undefined)
      throw new BadRequestException('确认必须提供 expectedRevision');
    return this.pipeline.confirm(
      id,
      action ?? 'confirm',
      target ? { target, expectedRevision: expectedRevision! } : undefined,
    );
  }

  @Post('projects/:id/rollback')
  rollback(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RollbackBodySchema)) body: unknown,
  ) {
    return this.pipeline.rollback(
      id,
      (body as { stage: Parameters<PipelineService['rollback']>[1] }).stage,
    );
  }

  /** 人物列表（含状态） */
  @Get('projects/:id/characters')
  characters(@Param('id') id: string) {
    return this.pipeline.characters(id);
  }

  /** 关系列表（含双方标识、类型与相对角色） */
  @Get('projects/:id/relations')
  relations(@Param('id') id: string) {
    return this.pipeline.relations(id);
  }

  @Get('projects/:id/outline')
  getOutline(@Param('id') id: string) {
    return this.outline.get(id);
  }

  @Patch('projects/:id/outline/config')
  configureOutline(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(OutlineConfigBodySchema))
    body: { expectedRevision: number; targetChapters: number },
  ) {
    return this.outline.configure(id, body.expectedRevision, body.targetChapters);
  }

  @Patch('projects/:id/outline/plan')
  saveOutlinePlan(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(OutlinePlanBodySchema))
    body: { expectedRevision: number; plan: OutlinePlan },
  ) {
    return this.outline.savePlan(id, body.expectedRevision, body.plan);
  }

  @Patch('projects/:id/outline/chapters/:number')
  saveOutlineChapter(
    @Param('id') id: string,
    @Param('number') number: string,
    @Body(new ZodValidationPipe(OutlineChapterBodySchema))
    body: { expectedRevision: number; chapter: ChapterSummary },
  ) {
    return this.outline.saveChapter(id, body.expectedRevision, Number(number), body.chapter);
  }

  @Get('projects/:id/prose')
  getProse(@Param('id') id: string) {
    return this.prose.detail(id);
  }

  @Get('projects/:id/prose/chapters/:number')
  async getProseChapter(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
  ) {
    const chapter = (await this.prose.detail(id)).chapters.find(
      (c) => c.chapterNumber === Number(number),
    );
    if (!chapter) throw new NotFoundException('章节不存在');
    return chapter;
  }

  @Post('projects/:id/prose/chapters/:number/retry')
  retryProse(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
  ) {
    return this.pipeline.proseAction(id, (prose) => prose.process(id, Number(number)));
  }

  @Post('projects/:id/prose/chapters/:number/regenerate')
  regenerateProse(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
  ) {
    void id;
    void number;
    throw new GoneException('候选稿功能已下线，请使用按建议修改');
  }

  @Post('projects/:id/prose/chapters/:number/restore')
  restoreProse(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
  ) {
    return this.proseRevision.restore(id, Number(number));
  }

  @Post('projects/:id/prose/chapters/:number/revisions')
  @HttpCode(202)
  createProseRevision(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
    @Body(new ZodValidationPipe(CreateProseRevisionBodySchema)) body: CreateProseRevisionBody,
  ) {
    return this.proseRevision.create(id, Number(number), body);
  }
  @Get('projects/:id/prose/chapters/:number/revisions/:revisionId')
  getProseRevision(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
    @Param('revisionId') revisionId: string,
  ) {
    return this.proseRevision.get(id, Number(number), revisionId);
  }
  @Post('projects/:id/prose/chapters/:number/revisions/:revisionId/apply')
  @HttpCode(202)
  applyProseRevision(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(ApplyProseRevisionBodySchema)) body: ApplyProseRevisionBody,
  ) {
    return this.proseRevision.apply(id, Number(number), revisionId, body);
  }
  @Post('projects/:id/prose/chapters/:number/revisions/:revisionId/discard')
  discardProseRevision(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
    @Param('revisionId') revisionId: string,
  ) {
    return this.proseRevision.discard(id, Number(number), revisionId);
  }

  @Post('projects/:id/prose/chapters/:number/confirm')
  acceptProse(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
    @Body(new ZodValidationPipe(ConfirmProseBodySchema)) body: ConfirmProseBody,
  ) {
    return this.pipeline.proseAction(id, (prose) => prose.accept(id, Number(number), body), true);
  }

  @Post('projects/:id/prose/chapters/:number/override')
  overrideProse(
    @Param('id') id: string,
    @Param('number', new ZodValidationPipe(ProseChapterParamSchema)) number: number,
    @Body(new ZodValidationPipe(OverrideProseReviewBodySchema)) body: OverrideProseReviewBody,
  ) {
    return this.pipeline.proseAction(id, (prose) => prose.override(id, Number(number), body));
  }

  @Post('projects/:id/mode')
  setMode(@Param('id') id: string, @Body(new ZodValidationPipe(SetModeBodySchema)) body: unknown) {
    return this.pipeline.setMode(
      id,
      (body as { mode: Parameters<PipelineService['setMode']>[1] }).mode,
    );
  }
}
