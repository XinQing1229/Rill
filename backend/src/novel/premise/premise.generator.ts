import { commitGeneration } from '../pipeline/execution-context.js';
import { Injectable } from '@nestjs/common';
import {
  GeneratedPremise,
  PremiseSchema,
  QuestionnaireAnswers,
  Stage,
  StageContext,
} from '@rill/shared';
import { LlmService } from '../../ai/llm.service.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { UsageRecorder } from '../../ai/observability/usage-recorder.js';
import { newTraceId } from '../../ai/observability/trace.js';
import { PrismaService } from '../prisma.service.js';
import { profileFor } from '../genre/genre-profile.js';
import { ArtifactRegistry, StageGenerator } from '../pipeline/artifact.registry.js';
import { premiseV1 } from '../prompts/premise-template.js';

const LENGTH_LABEL: Record<string, string> = {
  short: '短篇',
  medium: '中篇',
  long: '长篇',
};

@Injectable()
export class PremiseGenerator implements StageGenerator {
  readonly stage: Stage = 'premise';
  readonly requires = (): Stage[] => [];

  constructor(
    private readonly llm: LlmService,
    private readonly prompts: PromptRegistry,
    private readonly usageRecorder: UsageRecorder,
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactRegistry,
  ) {
    this.prompts.register(premiseV1);
    this.artifacts.registerGenerator(this);
    this.artifacts.registerStorage('premise', this.prisma);
  }

  async generate(
    _context: StageContext,
    answers: QuestionnaireAnswers,
    projectId: string,
  ): Promise<void> {
    const profile = profileFor(answers.genre);

    const prompt = this.prompts.render('premise', 'v1', {
      genre: profile.label,
      genreTraits: profile.traits.join('、'),
      tone: answers.tone,
      pov: answers.pov,
      length: LENGTH_LABEL[answers.length] ?? answers.length,
      idea: answers.idea ?? '',
      taboos: (answers.taboos ?? []).join('、'),
    });

    const traceId = newTraceId();
    const premise = await this.llm.completeStructured<GeneratedPremise>(
      PremiseSchema,
      [{ role: 'user', content: prompt }],
      { traceId, usage: 'draft' },
    );

    const usage = this.usageRecorder.get(traceId);
    await commitGeneration(this.prisma, async (tx) => {
      await tx.premise.update({
        where: { projectId },
        data: {
          data: JSON.stringify(premise),
          stale: false,
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: usage?.completionTokens ?? 0,
        },
      });

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
}
