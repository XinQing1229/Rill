import { BadRequestException, Injectable } from '@nestjs/common';
import { QuestionnaireAnswers, RelationListSchema, Stage, StageContext } from '@rill/shared';
import { LlmService } from '../../ai/llm.service';
import { PromptRegistry } from '../../ai/prompts/prompt.registry';
import { UsageRecorder } from '../../ai/observability/usage-recorder';
import { newTraceId } from '../../ai/observability/trace';
import { PrismaService } from '../prisma.service';
import { ArtifactRegistry, StageGenerator } from '../pipeline/artifact.registry';
import { renderUpstreamContext } from '../prompts/upstream-context';
import { relationsV1 } from '../prompts/relations-template';

interface NormalizedRelation {
  fromId: string;
  toId: string;
  type: string;
  fromRole: string;
  toRole: string;
  description: string;
}

@Injectable()
export class RelationGenerator implements StageGenerator {
  readonly stage: Stage = 'relations';
  readonly requires = (): Stage[] => ['characters'];

  constructor(
    private readonly llm: LlmService,
    private readonly prompts: PromptRegistry,
    private readonly usageRecorder: UsageRecorder,
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactRegistry,
  ) {
    this.prompts.register(relationsV1);
    this.artifacts.registerGenerator(this);
    this.artifacts.register('relations', async (projectId, stale) => {
      await this.prisma.relation.updateMany({ where: { projectId }, data: { stale } });
    });
  }

  async generate(
    context: StageContext,
    _answers: QuestionnaireAnswers,
    projectId: string,
  ): Promise<void> {
    const characters = await this.prisma.character.findMany({
      where: { projectId, status: 'done', stale: false },
    });
    if (characters.length < 2) {
      throw new BadRequestException('至少需要两个已确认人物才能生成关系');
    }

    const prompt = this.prompts.render('relations', 'v1', {
      upstream: renderUpstreamContext(context),
    });

    const traceId = newTraceId();
    const result = await this.llm.completeStructured<{
      relations: Array<Record<string, unknown>>;
    }>(RelationListSchema, [{ role: 'user', content: prompt }], { traceId, usage: 'draft' });

    const byName = new Map(characters.map((item) => [item.name, item]));
    const normalized = this.normalize(result.relations ?? [], byName);

    const usage = this.usageRecorder.get(traceId);
    const promptTokens = usage?.promptTokens ?? 0;
    const completionTokens = usage?.completionTokens ?? 0;

    await this.prisma.$transaction([
      this.prisma.relation.deleteMany({ where: { projectId } }),
      ...[...normalized.values()].map((relation) =>
        this.prisma.relation.create({
          data: {
            projectId,
            ...relation,
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

  /**
   * 规范化：按 fromId < toId 排序去重，方向性交换时同步交换双方角色。
   */
  private normalize(
    relations: Array<Record<string, unknown>>,
    byName: Map<string, { id: string }>,
  ): Map<string, NormalizedRelation> {
    const result = new Map<string, NormalizedRelation>();

    for (const relation of relations) {
      const from = byName.get(String(relation.fromName));
      const to = byName.get(String(relation.toName));
      // 跳过引用不存在人物的关系
      if (!from || !to) continue;
      if (from.id === to.id) continue;

      let fromId = from.id;
      let toId = to.id;
      let fromRole = String(relation.fromRole ?? '');
      let toRole = String(relation.toRole ?? '');

      if (fromId > toId) {
        [fromId, toId] = [toId, fromId];
        [fromRole, toRole] = [toRole, fromRole];
      }

      const key = `${fromId}|${toId}`;
      const existing = result.get(key);
      if (existing) {
        // 同一对人物完全可能有多重关系（既是仇敌又有利益）。
        // 保留主关系，把附加信息合并进描述，避免静默丢弃。
        const description = String(relation.description ?? '');
        const isNewType = relation.type && relation.type !== existing.type;
        const addition = [isNewType ? `[${relation.type}]` : '', description]
          .filter(Boolean)
          .join(' ');
        if (addition) {
          existing.description = existing.description
            ? `${existing.description}；${addition}`
            : addition;
        }
        continue;
      }

      result.set(key, {
        fromId,
        toId,
        type: String(relation.type ?? ''),
        fromRole,
        toRole,
        description: String(relation.description ?? ''),
      });
    }

    return result;
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
