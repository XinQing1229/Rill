import { premiseV3 } from './premise-template.js';
import { worldV3 } from './world-template.js';
import { PromptRegistry } from '../../ai/prompts/prompt.registry.js';

describe('故事想法提示词', () => {
  it.each([
    ['', ''],
    ['', '短线之路'],
    ['男大学生从一万元到一亿元', ''],
    ['男大学生从一万元到一亿元', '短线之路'],
  ])('故事想法 %s / 作者书名 %s 均可生成', (idea, title) => {
    const registry = new PromptRegistry();
    registry.register(premiseV3);
    const prompt = registry.render('premise', 'v3', {
      genre: '都市',
      genreTraits: '现实',
      length: '短篇',
      pov: '第一人称',
      idea,
      title,
    });
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('阅读体验：');
    expect(prompt).not.toContain('未命名作品');
    expect(prompt).toContain(idea || '作者未提供具体故事想法');
    expect(prompt).toContain(title ? '作者指定书名必须原样保留' : '作者未指定书名');
    expect(prompt).toContain('不得用开篇目标替换作者最终目标');
  });
  it('世界观无需历史阅读体验，仍遵守历史职业', () => {
    const registry = new PromptRegistry();
    registry.register(worldV3);
    const prompt = registry.render('world', 'v3', {
      genre: '悬疑',
      genreTraits: '推理',
      tier: 'light',
      upstream: '学生侦探',
      profession: '医者',
    });
    expect(prompt).not.toContain('阅读体验：');
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('医者');
  });
});
