import { QuestionnaireAnswers } from '@rill/shared';
import { QuestionnaireService, MissingRequiredAnswersError } from './questionnaire';

describe('QuestionnaireService', () => {
  const service = new QuestionnaireService();

  it('问卷包含 4 个必答项：类型、篇幅、基调、视角', () => {
    const { questions } = service.build('xuanhuan');
    const required = questions.filter((question) => question.required).map((q) => q.key);
    expect(required).toEqual(['genre', 'length', 'tone', 'pov']);
  });

  it('每个必答项（除类型）都带可选项，篇幅为短篇/中篇/长篇', () => {
    const { questions } = service.build('xuanhuan');
    const length = questions.find((q) => q.key === 'length');
    expect(length?.options).toEqual([
      { value: 'short', label: '短篇' },
      { value: 'medium', label: '中篇' },
      { value: 'long', label: '长篇' },
    ]);
    // 类型由第一步选择，其选项为空；其余必答项必须有选项，否则前端无法作答
    for (const key of ['length', 'tone', 'pov']) {
      const question = questions.find((q) => q.key === key);
      expect(question?.options.length).toBeGreaterThan(0);
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
      expect((error as MissingRequiredAnswersError).missing).toEqual(['tone', 'pov']);
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
    expect(service.build('dushi').version).toBe('v1');
  });
});
