import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import {
  ConfirmAction,
  ConfirmBodySchema,
  CreateProjectSchema,
  GENRES,
  GenerateBodySchema,
  Genre,
  RollbackBodySchema,
  SetModeBodySchema,
} from '@rill/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PipelineService } from './pipeline/pipeline.service.js';
import { QuestionnaireService } from './questionnaire/questionnaire.js';

@Controller('novel')
export class NovelController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly questionnaire: QuestionnaireService,
  ) {}

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

  /** 项目列表（列表页用，按更新时间倒序） */
  @Get('projects')
  list() {
    return this.pipeline.list();
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
    const { action } = body as { action?: ConfirmAction };
    return this.pipeline.confirm(id, action ?? 'confirm');
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

  @Post('projects/:id/mode')
  setMode(@Param('id') id: string, @Body(new ZodValidationPipe(SetModeBodySchema)) body: unknown) {
    return this.pipeline.setMode(
      id,
      (body as { mode: Parameters<PipelineService['setMode']>[1] }).mode,
    );
  }
}
