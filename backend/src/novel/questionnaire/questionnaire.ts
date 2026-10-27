import { BadRequestException, Injectable } from '@nestjs/common';
import {
  LENGTHS,
  LENGTH_LABELS,
  POVS,
  QUESTIONNAIRE_VERSION,
  QuestionnaireAnswers,
  REQUIRED_ANSWER_FIELDS,
  WRITING_STYLES,
  WRITING_STYLE_LABELS,
  type Question,
  type QuestionnaireDefinition,
} from '@rill/shared';
import { profileFor } from '../genre/genre-profile.js';

export type { Question, QuestionOption, QuestionnaireDefinition } from '@rill/shared';

export class MissingRequiredAnswersError extends Error {
  constructor(readonly missing: string[]) {
    const labels: Record<string, string> = {
      genre: '类型',
      length: '篇幅',
      pov: '叙事视角',
    };
    super(`还需填写：${missing.map((field) => labels[field] ?? field).join('、')}`);
    this.name = 'MissingRequiredAnswersError';
  }
}

@Injectable()
export class QuestionnaireService {
  /** 问卷结构：必答 3 项 + 选答 + 类型级联项 */
  build(genre: QuestionnaireAnswers['genre']): QuestionnaireDefinition {
    const profile = profileFor(genre);

    const questions: Question[] = [
      { key: 'genre', label: '类型', required: true, options: [] },
      {
        key: 'length',
        label: '篇幅',
        required: true,
        options: LENGTHS.map((length) => ({ value: length, label: LENGTH_LABELS[length] })),
      },
      {
        key: 'pov',
        label: '叙事视角',
        required: true,
        options: POVS.map((pov) => ({ value: pov, label: pov })),
      },
    ];

    questions.push({
      key: 'writingStyle',
      label: '文风',
      required: false,
      options: WRITING_STYLES.map((id) => ({ value: id, label: WRITING_STYLE_LABELS[id] })),
    });

    // 选答：人物数量（默认按篇幅配置，可在此覆盖）
    questions.push({
      key: 'extras.characterScale',
      label: '人物数量',
      required: false,
      options: [
        { value: 'compact', label: '少量' },
        { value: 'standard', label: '适中' },
        { value: 'rich', label: '较多' },
      ],
    });

    // 类型特有的选答项（级联）
    for (const extra of profile.extraQuestions) {
      questions.push({
        key: `extras.${extra.key}`,
        label: extra.label,
        required: false,
        options: extra.options.map((option) => ({ value: option, label: option })),
        ...(extra.allowCustom ? { allowCustom: true } : {}),
      });
    }

    return { version: QUESTIONNAIRE_VERSION, questions };
  }

  /** 必答项校验：缺失则抛出并列出缺失项 */
  validate(answers: Partial<QuestionnaireAnswers>): void {
    const missing = REQUIRED_ANSWER_FIELDS.filter((field) => {
      const value = answers[field];
      return (
        value === undefined ||
        value === null ||
        (Array.isArray(value) ? value.length === 0 : value.trim() === '')
      );
    });
    if (missing.length > 0) {
      throw new MissingRequiredAnswersError([...missing]);
    }
    if (answers.length !== 'short') throw new BadRequestException('当前仅支持短篇小说');
  }
}
