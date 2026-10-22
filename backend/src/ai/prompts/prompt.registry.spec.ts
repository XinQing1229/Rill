import { PromptRegistry, PromptVariableMissingError } from './prompt.registry.js';
import { sampleBookV1 } from './templates/sample-book.js';

describe('PromptRegistry', () => {
  let registry: PromptRegistry;

  beforeEach(() => {
    registry = new PromptRegistry();
    registry.register(sampleBookV1);
  });

  it('按模板名与版本渲染', () => {
    const prompt = registry.render('sample-book', 'v1', { topic: '南宋临安推理' });
    expect(prompt).toContain('南宋临安推理');
    expect(prompt).toContain('小说策划编辑');
  });

  it('缺少必填变量时渲染阶段报错', () => {
    expect(() => registry.render('sample-book', 'v1', {})).toThrow(PromptVariableMissingError);
    expect(() => registry.render('sample-book', 'v1', { topic: '' })).toThrow(
      PromptVariableMissingError,
    );
  });

  it('模板不存在时报错', () => {
    expect(() => registry.render('sample-book', 'v9', { topic: 'x' })).toThrow(/不存在/);
  });

  it('稳定前缀在前、可变内容在后（利于命中上下文缓存）', () => {
    const first = registry.render('sample-book', 'v1', { topic: '题材A' });
    const second = registry.render('sample-book', 'v1', { topic: '题材B' });
    const commonPrefixLength = (a: string, b: string) => {
      let index = 0;
      while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
      return index;
    };
    // 不同变量下，前缀仍应保持一致且占相当比例
    expect(commonPrefixLength(first, second)).toBeGreaterThan(first.length * 0.5);
    expect(first.indexOf('题材A')).toBeGreaterThan(0);
  });
});
