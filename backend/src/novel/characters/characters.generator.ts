import { Injectable } from '@nestjs/common';
import { CharacterListSchema, QuestionnaireAnswers, Stage, StageContext } from '@rill/shared';
import { LlmService } from '../../ai/llm.service';
import { PromptRegistry } from '../../ai/prompts/prompt.registry';
import { UsageRecorder } from '../../ai/observability/usage-recorder';
import { newTraceId } from '../../ai/observability/trace';
import { PrismaService } from '../prisma.service';
import { GenreProfile, profileFor } from '../genre/genre-profile';
import { ArtifactRegistry, StageGenerator } from '../pipeline/artifact.registry';
import { renderUpstreamContext } from '../prompts/upstream-context';
import { charactersV1 } from '../prompts/characters-template';

/** 问卷「人物规模」选答到人数的映射 */
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
    this.prompts.register(charactersV1);
    this.artifacts.registerGenerator(this);
    // 重新生成人物 → 关系失效
    this.artifacts.register('characters', async (projectId, stale) => {
      await this.prisma.character.updateMany({ where: { projectId }, data: { stale } });
    });
  }

  async generate(
    context: StageContext,
    answers: QuestionnaireAnswers,
    projectId: string,
  ): Promise<void> {
    const profile: GenreProfile = profileFor(answers.genre);
    const count = this.resolveCount(answers, profile);

    const prompt = this.prompts.render('characters', 'v1', {
      upstream: renderUpstreamContext(context),
      count: String(count),
    });

    const traceId = newTraceId();
    const result = await this.llm.completeStructured<{
      characters: Array<Record<string, unknown>>;
    }>(CharacterListSchema, [{ role: 'user', content: prompt }], { traceId, usage: 'draft' });

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

    await this.prisma.$transaction([
      this.prisma.character.deleteMany({ where: { projectId } }),
      ...characters.map((item) =>
        this.prisma.character.create({
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

    await this.recordProjectUsage(projectId, usage);
  }

  private resolveCount(answers: QuestionnaireAnswers, profile: GenreProfile): number {
    const scale = answers.extras?.characterScale;
    if (scale && SCALE_COUNTS[scale]) {
      return SCALE_COUNTS[scale];
    }
    return profile.characterCount[answers.length];
  }

  private async recordProjectUsage(
    projectId: string,
    usage: { promptTokens: number; completionTokens: number } | undefined,
  ): Promise<void> {
    if (!usage) return;
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        promptTokens: { increment: usage.promptTokens },
        completionTokens: { increment: usage.completionTokens },
      },
    });
  }
}
