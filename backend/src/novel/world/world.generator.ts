import { commitGeneration } from '../pipeline/execution-context.js';
import { BadRequestException, Injectable } from '@nestjs/common';
import { QuestionnaireAnswers, Stage, StageContext, worldSchemaFor } from '@rill/shared';
import { LlmService } from '../../ai/llm.service.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';
import { UsageRecorder } from '../../ai/observability/usage-recorder.js';
import { newTraceId } from '../../ai/observability/trace.js';
import { PrismaService } from '../prisma.service.js';
import { profileFor } from '../genre/genre-profile.js';
import { ArtifactRegistry, StageGenerator } from '../pipeline/artifact.registry.js';
import { renderUpstreamContext } from '../prompts/upstream-context.js';
import { worldV1 } from '../prompts/world-template.js';

@Injectable()
export class WorldGenerator implements StageGenerator {
  readonly stage: Stage = 'world';
  readonly requires = (): Stage[] => ['premise'];

  constructor(
    private readonly llm: LlmService,
    private readonly prompts: PromptRegistry,
    private readonly usageRecorder: UsageRecorder,
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactRegistry,
  ) {
    this.prompts.register(worldV1);
    this.artifacts.registerGenerator(this);
    this.artifacts.registerStorage('world', this.prisma);
  }

  async generate(
    context: StageContext,
    answers: QuestionnaireAnswers,
    projectId: string,
  ): Promise<void> {
    const profile = profileFor(answers.genre);
    if (profile.worldWeight === 'minimal') {
      throw new BadRequestException(`类型「${profile.label}」不生成世界观阶段`);
    }

    const prompt = this.prompts.render('world', 'v1', {
      upstream: renderUpstreamContext(context),
      genre: profile.label,
      genreTraits: profile.traits.join('、'),
      tone: answers.tone,
      tier: profile.worldWeight,
    });

    const schema = worldSchemaFor(answers.genre);
    const traceId = newTraceId();
    const generated = await this.llm.completeStructured<Record<string, unknown>>(
      schema,
      [{ role: 'user', content: prompt }],
      // 详细档内容多，需要更大的输出预算（实测默认 2048 会被截断）
      { traceId, usage: 'draft', maxTokens: profile.worldMaxTokens },
    );

    // 时代与地点从种子继承，不由模型生成
    const data: Record<string, unknown> = {
      era: context.premise?.setting.era ?? '',
      place: context.premise?.setting.place ?? '',
      ...generated,
    };

    // 按详略档位裁剪：精简档只保留规则与势力
    if (profile.worldWeight === 'light') {
      delete data.geography;
      delete data.history;
      delete data.secrets;
    }

    const usage = this.usageRecorder.get(traceId);
    const payload = {
      data: JSON.stringify(data),
      status: 'done',
      stale: false,
      error: null,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
    };

    await commitGeneration(this.prisma, async (tx) => {
      await tx.worldSetting.upsert({
        where: { projectId },
        update: payload,
        create: { projectId, ...payload },
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
