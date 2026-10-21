import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Genre, GENRES, PipelineMode, QuestionnaireAnswers, Stage } from '@rill/shared';
import { PipelineService } from './pipeline/pipeline.service';
import { QuestionnaireService } from './questionnaire/questionnaire';

interface CreateProjectBody {
  title: string;
  answers: QuestionnaireAnswers;
  mode?: PipelineMode;
}

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
      return { error: `未知类型: ${genre}`, available: GENRES };
    }
    return this.questionnaire.build(valid as Genre);
  }

  @Post('projects')
  create(@Body() body: CreateProjectBody) {
    return this.pipeline.create(body);
  }

  @Get('projects/:id')
  get(@Param('id') id: string) {
    return this.pipeline.get(id);
  }

  /** 触发生成：立即返回，状态由流水线推进 */
  @Post('projects/:id/generate')
  generate(@Param('id') id: string, @Body() body?: { force?: boolean; wait?: boolean }) {
    return this.pipeline.generate(id, body ?? {});
  }

  @Post('projects/:id/confirm')
  confirm(@Param('id') id: string) {
    return this.pipeline.confirm(id);
  }

  @Post('projects/:id/rollback')
  rollback(@Param('id') id: string, @Body() body: { stage: Stage }) {
    return this.pipeline.rollback(id, body.stage);
  }

  @Post('projects/:id/mode')
  setMode(@Param('id') id: string, @Body() body: { mode: PipelineMode }) {
    return this.pipeline.setMode(id, body.mode);
  }
}
