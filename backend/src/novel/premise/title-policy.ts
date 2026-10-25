import { ProjectTitleSourceSchema, type GeneratedPremise } from '@rill/shared';
import { BadGatewayException } from '@nestjs/common';

/** 正式生成和候选采用共用命名规则；缺少来源的旧项目视为作者命名。 */
export function resolvePremiseTitle(
  project: { title: string; titleSource?: string },
  premise: GeneratedPremise,
) {
  const source = ProjectTitleSourceSchema.parse(project.titleSource ?? 'author');
  const title = source === 'author' ? project.title : premise.title.trim();
  if (!title || title.length > 100)
    throw new BadGatewayException('生成书名须为 1 至 100 字符，请重试');
  return {
    premise: { ...premise, title },
    project: { title, titleSource: source === 'author' ? 'author' : 'generated' },
  };
}
