import { resolvePremiseTitle } from './title-policy.js';
import type { GeneratedPremise } from '@rill/shared';

// 命名规则仅访问 title，其他种子字段由生成 schema 负责校验。
const candidate = { title: '  万元起航  ' } as GeneratedPremise;

describe('正式种子命名策略', () => {
  it.each(['placeholder', 'generated'])('%s 成功后使用正式种子书名', (titleSource) => {
    const result = resolvePremiseTitle({ title: '未命名作品', titleSource }, candidate);
    expect(result.premise.title).toBe('万元起航');
    expect(result.project).toEqual({ title: '万元起航', titleSource: 'generated' });
  });
  it.each([undefined, 'author'])('旧项目或作者书名 %s 不被覆盖', (titleSource) => {
    const result = resolvePremiseTitle({ title: '未命名作品', titleSource }, candidate);
    expect(result.premise.title).toBe('未命名作品');
    expect(result.project.titleSource).toBe('author');
  });
  it.each(['', 'a'.repeat(101)])('拒绝无效的生成书名', (title) => {
    expect(() =>
      resolvePremiseTitle(
        { title: '未命名作品', titleSource: 'placeholder' },
        { ...candidate, title },
      ),
    ).toThrow();
  });
});
