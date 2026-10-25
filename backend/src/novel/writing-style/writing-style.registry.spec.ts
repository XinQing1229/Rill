import {
  DEFAULT_WRITING_STYLE,
  QuestionnaireAnswersSchema,
  WritingStyleSelectionSchema,
} from '@rill/shared';
import { renderWritingStyle, type WritingStyleStage } from './writing-style.registry.js';
import { proseDependencyFingerprint } from '../prose/prose-fingerprint.js';
import { proseHash } from '../prose/prose-files.service.js';

const answers = { genre: 'yanqing', length: 'short', tone: '暗黑', pov: '第三人称限知' };

describe('版本化文风与历史兼容', () => {
  it('旧答案不补默认，保留关系及阅读体验；新文风严格校验', () => {
    const legacy = QuestionnaireAnswersSchema.parse({
      ...answers,
      extras: { relation: '契约搭档' },
    });
    expect(legacy.writingStyle).toBeUndefined();
    expect(legacy.extras?.relation).toBe('契约搭档');
    expect(legacy.tone).toBe('暗黑');
    expect(
      QuestionnaireAnswersSchema.parse({ ...answers, writingStyle: DEFAULT_WRITING_STYLE })
        .writingStyle,
    ).toEqual(DEFAULT_WRITING_STYLE);
    for (const style of [
      { id: 'other', version: 'v1' },
      { id: 'short-satisfying', version: 'v2' },
      { ...DEFAULT_WRITING_STYLE, rules: '覆盖规则' },
      null,
    ]) {
      expect(WritingStyleSelectionSchema.safeParse(style).success).toBe(false);
    }
  });

  it.each<WritingStyleStage>([
    'premise',
    'world',
    'characters',
    'relations',
    'outline',
    'prose',
    'review',
  ])('%s 使用固定版本规则且不向历史项目注入', (stage) => {
    expect(renderWritingStyle(undefined, stage)).toBe('');
    const rule = renderWritingStyle(DEFAULT_WRITING_STYLE, stage);
    expect(rule).toContain('短篇爽文 v1');
    expect(rule).toContain('阅读体验');
    expect(rule).toContain('不强制第一人称');
  });

  it('审核、正文和设定阶段各自使用适当规则', () => {
    expect(renderWritingStyle(DEFAULT_WRITING_STYLE, 'review')).toContain('默认 warning');
    expect(renderWritingStyle(DEFAULT_WRITING_STYLE, 'prose')).toContain('实际后果');
    expect(renderWritingStyle(DEFAULT_WRITING_STYLE, 'prose')).toContain(
      '不得凭空增添决定胜负的证据',
    );
    expect(renderWritingStyle(DEFAULT_WRITING_STYLE, 'world')).not.toContain('短句、短段');
  });

  it('历史指纹逐字兼容，有文风时纳入版本', () => {
    const previous = [{ chapterNumber: 1, hash: 'h', data: {} }];
    const legacy = proseHash(JSON.stringify({ outline: 3, beat: 0, previous }));
    expect(proseDependencyFingerprint(3, 0, previous)).toBe(legacy);
    const styled = proseDependencyFingerprint(3, 0, previous, DEFAULT_WRITING_STYLE);
    expect(styled).not.toBe(legacy);
    expect(styled).toBe(
      proseHash(
        JSON.stringify({ outline: 3, beat: 0, previous, writingStyle: DEFAULT_WRITING_STYLE }),
      ),
    );
  });
});
