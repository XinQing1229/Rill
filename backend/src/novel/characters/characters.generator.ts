import { renderWritingStyle } from '../writing-style/writing-style.registry.js';
import { commitGeneration } from '../pipeline/execution-context.js';
import { Injectable } from '@nestjs/common';
import { CharacterListSchema, QuestionnaireAnswers, Stage, StageContext } from '@rill/shared';
import { LlmService } from '../../ai/llm.service.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { UsageRecorder } from '../../ai/observability/usage-recorder.js';
import { newTraceId } from '../../ai/observability/trace.js';
import { PrismaService } from '../prisma.service.js';
import { GenreProfile, profileFor } from '../genre/genre-profile.js';
import { ArtifactRegistry, StageGenerator } from '../pipeline/artifact.registry.js';
import {
  renderQuestionnaireConstraints,
  renderUpstreamContext,
} from '../prompts/upstream-context.js';
import { charactersV2 } from '../prompts/characters-template.js';

/** 问卷「人物数量」选答到人数的映射 */
const SCALE_COUNTS: Record<string, number> = {
  compact: 3,
  standard: 4,
  rich: 6,
};

@Injectable()
export class CharacterGenerator implements StageGenerator {
  readonly stage: Stage = 'characters';
  // 跳过世界观的类型不依赖 world
  readonly requires = (answers: QuestionnaireAnswers): Stage[] =>
    profileFor(answers.genre).worldWeight === 'minimal' ? ['premise'] : ['premise', 'world'];

  constructor(
    private readonly llm: LlmService,
    private readonly prompts: PromptRegistry,
    private readonly usageRecorder: UsageRecorder,
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactRegistry,
  ) {
    this.prompts.register(charactersV2);
    this.artifacts.registerGenerator(this);
    // 重新生成人物 → 关系失效
    this.artifacts.registerStorage('characters', this.prisma);
  }

  async generate(
    context: StageContext,
    answers: QuestionnaireAnswers,
    projectId: string,
  ): Promise<void> {
    const profile: GenreProfile = profileFor(answers.genre);
    const count = this.resolveCount(answers, profile);

    const prompt = this.prompts.render('characters', 'v2', {
      writingStyle: renderWritingStyle(answers.writingStyle, 'characters'),
      upstream: [renderUpstreamContext(context), renderQuestionnaireConstraints(answers)]
        .filter(Boolean)
        .join('\n\n'),
      count: String(count),
    });

    const traceId = newTraceId();
    const result = await this.llm.completeStructured<{
      characters: Array<Record<string, unknown>>;
    }>(CharacterListSchema, [{ role: 'user', content: prompt }], { traceId });

    const characters = result.characters ?? [];
    if (characters.length === 0) {
      throw new Error('人物生成为空');
    }
    // 保底包含主角：若模型未标注，则把第一个人物提升为主角
    if (!characters.some((item) => item.role === 'protagonist') && characters[0]) {
      characters[0].role = 'protagonist';
    }

    const usage = this.usageRecorder.get(traceId);
    const promptTokens = usage?.promptTokens ?? 0;
    const completionTokens = usage?.completionTokens ?? 0;

    await commitGeneration(this.prisma, async (tx) => {
      await Promise.all([
        tx.character.deleteMany({ where: { projectId } }),
        ...characters.map((item) =>
          tx.character.create({
            data: {
              projectId,
              name: String(item.name),
              role: String(item.role),
              data: JSON.stringify(item),
              status: 'done',
              stale: false,
              promptTokens,
              completionTokens,
            },
          }),
        ),
      ]);

      if (usage)
        await tx.project.update({
          where: { id: projectId },
          data: {
            promptTokens: { increment: usage.promptTokens },
            completionTokens: { increment: usage.completionTokens },
          },
        });
    });
  }

  private resolveCount(answers: QuestionnaireAnswers, profile: GenreProfile): number {
    const scale = answers.extras?.characterScale;
    if (scale && SCALE_COUNTS[scale]) {
      return SCALE_COUNTS[scale];
    }
    return profile.characterCount[answers.length];
  }
}
