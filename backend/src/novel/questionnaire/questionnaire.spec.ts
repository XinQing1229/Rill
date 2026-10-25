import {
  CreateProjectSchema,
  QuestionnaireAnswers,
  QuestionnaireAnswersSchema,
} from '@rill/shared';
import { QuestionnaireService, MissingRequiredAnswersError } from './questionnaire.js';

describe('QuestionnaireService', () => {
  const service = new QuestionnaireService();

  it('问卷包含 3 个必答项：类型、篇幅、视角', () => {
    const { questions } = service.build('xuanhuan');
    const required = questions.filter((question) => question.required).map((q) => q.key);
    expect(required).toEqual(['genre', 'length', 'pov']);
  });

  it('每个必答项（除类型）都带可选项，篇幅仅支持短篇', () => {
    const { questions } = service.build('xuanhuan');
    const length = questions.find((q) => q.key === 'length');
    expect(length?.options).toEqual([{ value: 'short', label: '短篇' }]);
    // 类型由第一步选择，其选项为空；其余必答项必须有选项，否则前端无法作答
    for (const key of ['length', 'pov']) {
      const question = questions.find((q) => q.key === key);
      expect(question?.options.length).toBeGreaterThan(0);
    }
  });

  it('契约及业务校验均拒绝已移除篇幅', () => {
    for (const length of ['medium', 'long']) {
      const answers = { genre: 'dushi', length, tone: '温暖', pov: '第一人称' };
      expect(QuestionnaireAnswersSchema.safeParse(answers).success).toBe(false);
      expect(() => service.validate(answers as QuestionnaireAnswers)).toThrow('仅支持短篇');
    }
  });

  it('必答项齐全时校验通过', () => {
    const answers: QuestionnaireAnswers = {
      genre: 'xuanhuan',
      length: 'short',
      tone: '热血',
      pov: '第一人称',
    };
    expect(() => service.validate(answers)).not.toThrow();
  });

  it('缺少必答项时报错并列出缺失项', () => {
    expect(() => service.validate({ genre: 'xuanhuan' })).toThrow(MissingRequiredAnswersError);
    try {
      service.validate({ genre: 'xuanhuan', length: 'short' });
    } catch (error) {
      expect((error as MissingRequiredAnswersError).missing).toEqual(['pov']);
    }
  });

  it('类型相关项随类型级联出现（玄幻含金手指、悬疑不含）', () => {
    const xuanhuan = service.build('xuanhuan');
    expect(xuanhuan.questions.some((q) => q.key === 'extras.goldenFinger')).toBe(true);

    const xuanyi = service.build('xuanyi');
    expect(xuanyi.questions.some((q) => q.key === 'extras.goldenFinger')).toBe(false);
    expect(xuanyi.questions.some((q) => q.key === 'extras.caseScale')).toBe(true);
  });

  it('问卷带版本号', () => {
    expect(service.build('dushi').version).toBe('v3');
  });

  it('所有类型包含唯一文风且不再提供关系问卷', () => {
    for (const genre of [
      'xuanhuan',
      'yanqing',
      'xuanyi',
      'dushi',
      'lishi',
      'kehuan',
      'other',
    ] as const) {
      const questions = service.build(genre).questions;
      expect(questions.find((q) => q.key === 'extras.relation')).toBeUndefined();
      expect(questions.find((q) => q.key === 'writingStyle')).toEqual({
        key: 'writingStyle',
        label: '文风',
        required: false,
        options: [{ value: 'short-satisfying', label: '短篇爽文' }],
      });
      expect(questions.find((q) => q.key === 'tone')).toBeUndefined();
      expect(questions.find((q) => q.key === 'extras.profession')).toBeUndefined();
    }
  });

  it('无需阅读体验即可通过，历史阅读体验仍可读取', () => {
    const answers = { genre: 'yanqing', length: 'short', pov: '第一人称' } as const;
    expect(() => service.validate(answers)).not.toThrow();
    expect(QuestionnaireAnswersSchema.parse({ ...answers, tone: '温柔' }).tone).toBe('温柔');
  });
});

describe('创作意图创建契约', () => {
  const answers = { genre: 'dushi', length: 'short', pov: '第一人称' } as const;
  it('书名、故事想法可空，旧字段被剔除，保留其他偏好', () => {
    const result = CreateProjectSchema.parse({
      title: '   ',
      answers: {
        ...answers,
        idea: '  男大学生短线从一万到一亿  ',
        tone: '热血',
        extras: { profession: '商战', relation: '同学', characterScale: 'compact' },
      },
    });
    expect(result.title).toBeUndefined();
    expect(result.answers.idea).toBe('男大学生短线从一万到一亿');
    expect(result.answers).not.toHaveProperty('tone');
    expect(result.answers.extras).toEqual({ characterScale: 'compact' });
    expect(CreateProjectSchema.parse({ answers }).answers.idea).toBeUndefined();
  });
  it('新建长度限制不影响历史问卷读取', () => {
    expect(CreateProjectSchema.safeParse({ title: 'a'.repeat(101), answers }).success).toBe(false);
    expect(
      CreateProjectSchema.safeParse({ answers: { ...answers, idea: 'a'.repeat(2001) } }).success,
    ).toBe(false);
    expect(
      QuestionnaireAnswersSchema.safeParse({
        ...answers,
        idea: 'a'.repeat(2001),
        tone: '轻松',
        extras: { profession: '医者' },
      }).success,
    ).toBe(true);
  });
});
