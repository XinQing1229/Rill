import { renderWritingStyle } from '../writing-style/writing-style.registry.js';
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
import { resolvePremiseTitle } from './title-policy.js';
import { premiseV2, premiseV3 } from '../prompts/premise-template.js';

const LENGTH_LABEL: Record<string, string> = {
  short: '短篇',
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
    this.prompts.register(premiseV2);
    this.prompts.register(premiseV3);
    this.artifacts.registerGenerator(this);
    this.artifacts.registerStorage('premise', this.prisma);
  }

  async generate(
    _context: StageContext,
    answers: QuestionnaireAnswers,
    projectId: string,
  ): Promise<void> {
    const profile = profileFor(answers.genre);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { title: true, titleSource: true },
    });

    const prompt = this.prompts.render('premise', 'v3', {
      writingStyle: renderWritingStyle(answers.writingStyle, 'premise'),
      genre: profile.label,
      genreTraits: profile.traits.join('、'),
      tone: answers.tone ?? '',
      profession: answers.extras?.profession ?? '',
      pov: answers.pov,
      length: LENGTH_LABEL[answers.length] ?? answers.length,
      title: !project.titleSource || project.titleSource === 'author' ? project.title : '',
      idea: answers.idea ?? '',
      taboos: (answers.taboos ?? []).join('、'),
      relation: answers.extras?.relation ?? '',
    });

    const traceId = newTraceId();
    const premise = await this.llm.completeStructured<GeneratedPremise>(
      PremiseSchema,
      [{ role: 'user', content: prompt }],
      { traceId, usage: 'draft' },
    );

    const resolved = resolvePremiseTitle(project, premise);
    const usage = this.usageRecorder.get(traceId);
    await commitGeneration(this.prisma, async (tx) => {
      await tx.premise.update({
        where: { projectId },
        data: {
          data: JSON.stringify(resolved.premise),
          stale: false,
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: usage?.completionTokens ?? 0,
        },
      });

      await tx.project.update({
        where: { id: projectId },
        data: {
          ...resolved.project,
          promptTokens: { increment: usage?.promptTokens ?? 0 },
          completionTokens: { increment: usage?.completionTokens ?? 0 },
        },
      });
    });
  }
}
