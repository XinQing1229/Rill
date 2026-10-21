import { StageContext } from '@rill/shared';

/**
 * 把已确认的上游产物渲染成稳定的 prompt 段落。
 * 组织原则：固定顺序、稳定前缀在前，以命中 DeepSeek 的上下文缓存。
 * world / characters / relations 三个模板共用，避免重复拼接。
 */
export function renderUpstreamContext(context: StageContext): string {
  const sections: string[] = [];

  if (context.premise) {
    const premise = context.premise;
    const protagonist = premise.protagonist;
    const setting = premise.setting;
    sections.push(
      [
        '【种子设定】',
        `书名：${premise.title}`,
        `梗概：${premise.logline}`,
        `主题：${premise.theme}`,
        `核心冲突：${premise.coreConflict}`,
        protagonist
          ? `主角：${protagonist.name}｜${protagonist.identity}｜想要：${protagonist.desire}｜软肋：${protagonist.flaw}`
          : '主角：（未设定）',
        setting ? `背景：${setting.era}，${setting.place}；${setting.socialBackground}` : '',
        `需要避免：${(premise.taboos ?? []).join('、') || '无'}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (context.world) {
    const world = context.world as {
      summary?: string;
      rules?: Array<{ name: string; description: string }>;
      factions?: Array<{ name: string; nature: string; stance: string }>;
    };
    const lines = ['【世界观】'];
    if (world.summary) lines.push(`概述：${world.summary}`);
    if (world.rules?.length) {
      lines.push('规则：');
      for (const rule of world.rules) lines.push(`- ${rule.name}：${rule.description}`);
    }
    if (world.factions?.length) {
      lines.push('势力：');
      for (const faction of world.factions) {
        lines.push(`- ${faction.name}（${faction.nature}）：${faction.stance}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  if (context.characters?.length) {
    const lines = ['【已确认人物】'];
    for (const character of context.characters) {
      lines.push(
        `- ${character.name}（${character.role}）：${character.identity}｜想要：${character.desire}｜软肋：${character.flaw}`,
      );
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}
