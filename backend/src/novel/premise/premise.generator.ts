import { Injectable } from '@nestjs/common';
import { Premise, PremiseSchema, QuestionnaireAnswers, StoryLength } from '@rill/shared';
import { LlmService } from '../../ai/llm.service';
import { PromptRegistry } from '../../ai/prompts/prompt.registry';
import { UsageRecorder } from '../../ai/observability/usage-recorder';
import { newTraceId } from '../../ai/observability/trace';
import { PrismaService } from '../prisma.service';
import { profileFor } from '../genre/genre-profile';
import { premiseV1 } from '../prompts/premise-template';
import { ArtifactRegistry } from './artifact.registry';

const LENGTH_LABEL: Record<StoryLength, string> = {
  short: '短篇',
  medium: '中篇',
  long: '长篇',
};

interface ProjectLike {
  id: string;
  answers: string;
}

@Injectable()
export class PremiseGenerator {
  constructor(
    private readonly llm: LlmService,
    private readonly prompts: PromptRegistry,
    private readonly usageRecorder: UsageRecorder,
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactRegistry,
  ) {
    this.prompts.register(premiseV1);
    this.artifacts.register('premise', async (projectId, stale) => {
      await this.prisma.premise.update({ where: { projectId }, data: { stale } });
    });
  }

  async generate(project: ProjectLike): Promise<Premise> {
    const answers = JSON.parse(project.answers) as QuestionnaireAnswers;
    const profile = profileFor(answers.genre);

    const prompt = this.prompts.render('premise', 'v1', {
      genre: profile.label,
      genreTraits: profile.traits.join('、'),
      tone: answers.tone,
      pov: answers.pov,
      length: LENGTH_LABEL[answers.length],
      idea: answers.idea ?? '',
      taboos: (answers.taboos ?? []).join('、'),
    });

    const traceId = newTraceId();
    const premise = await this.llm.completeStructured<Premise>(
      PremiseSchema,
      [{ role: 'user', content: prompt }],
      { traceId, usage: 'draft' },
    );

    const usage = this.usageRecorder.get(traceId);
    await this.prisma.premise.update({
      where: { projectId: project.id },
      data: {
        data: JSON.stringify(premise),
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
      },
    });

    return premise;
  }
}
