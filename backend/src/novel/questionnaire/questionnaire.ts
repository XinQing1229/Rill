import { Injectable } from '@nestjs/common';
import {
  POVS,
  QUESTIONNAIRE_VERSION,
  QuestionnaireAnswers,
  REQUIRED_ANSWER_FIELDS,
  TONES,
} from '@rill/shared';
import { profileFor } from '../genre/genre-profile';

export interface QuestionOption {
  value: string;
  label: string;
}

export interface Question {
  key: keyof QuestionnaireAnswers | string;
  label: string;
  required: boolean;
  options: QuestionOption[];
}

export interface QuestionnaireDefinition {
  version: string;
  questions: Question[];
}

export class MissingRequiredAnswersError extends Error {
  constructor(readonly missing: string[]) {
    super(`问卷缺少必答项: ${missing.join(', ')}`);
    this.name = 'MissingRequiredAnswersError';
  }
}

@Injectable()
export class QuestionnaireService {
  /** 问卷结构：必答 4 项 + 选答 + 类型级联项 */
  build(genre: QuestionnaireAnswers['genre']): QuestionnaireDefinition {
    const profile = profileFor(genre);

    const questions: Question[] = [
      { key: 'genre', label: '类型', required: true, options: [] },
      { key: 'length', label: '篇幅', required: true, options: [] },
      {
        key: 'tone',
        label: '基调',
        required: true,
        options: TONES.map((tone) => ({ value: tone, label: tone })),
      },
      {
        key: 'pov',
        label: '叙事视角',
        required: true,
        options: POVS.map((pov) => ({ value: pov, label: pov })),
      },
    ];

    // 类型特有的选答项（级联）
    for (const extra of profile.extraQuestions) {
      questions.push({
        key: `extras.${extra.key}`,
        label: extra.label,
        required: false,
        options: extra.options.map((option) => ({ value: option, label: option })),
      });
    }

    return { version: QUESTIONNAIRE_VERSION, questions };
  }

  /** 必答项校验：缺失则抛出并列出缺失项 */
  validate(answers: Partial<QuestionnaireAnswers>): void {
    const missing = REQUIRED_ANSWER_FIELDS.filter((field) => {
      const value = answers[field];
      return value === undefined || value === null || value === '';
    });
    if (missing.length > 0) {
      throw new MissingRequiredAnswersError([...missing]);
    }
  }
}
