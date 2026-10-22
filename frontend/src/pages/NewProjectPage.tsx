import { useMemo, useState } from 'react';
import { Alert, App, Button, Input, Select, Skeleton } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import {
  CreateProjectSchema,
  GENRE_LABELS,
  GENRES,
  REQUIRED_ANSWER_FIELDS,
  type Genre,
  type Question,
  type QuestionnaireAnswers,
} from '@rill/shared';
import { ApiError } from '../api/client';
import { createProject } from '../api/novel';
import { useQuestionnaire } from '../hooks/useQuestionnaire';

const GENRE_HINTS: Record<Genre, string> = {
  xuanhuan: '力量体系与境界',
  dushi: '现代都市行业与生活',
  xuanyi: '悬念布局与真相',
  lishi: '历史背景与制度',
  kehuan: '技术推演与边界',
  yanqing: '情感关系与障碍',
  other: '不拘一格',
};

/** 问卷键 → 答案字段：必答项直取，extras. 前缀归入 extras */
function answerFromValues(values: Record<string, string>): QuestionnaireAnswers | null {
  const extras: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue;
    if (key.startsWith('extras.')) {
      extras[key.slice('extras.'.length)] = value;
    }
  }
  const candidate = {
    genre: values.genre as Genre | undefined,
    length: values.length as QuestionnaireAnswers['length'] | undefined,
    tone: values.tone,
    pov: values.pov,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  };
  const parsed = CreateProjectSchema.shape.answers.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function QuestionControl({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const options = question.options.map((option) => ({
    label: option.label,
    value: option.value,
  }));
  if (options.length <= 6) {
    // chip 按钮组（与设计原型一致）；aria-pressed 表达选中态
    return (
      <div className="choices" role="group" aria-label={question.label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="choice"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <Select
      style={{ width: 240 }}
      placeholder="请选择"
      options={options}
      value={value}
      onChange={onChange}
      aria-label={question.label}
    />
  );
}

/** 问卷向导：先选类型，再按问卷定义动态渲染（级联）；提交前本地校验必答项 */
export function NewProjectPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState<Genre | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    data: questionnaire,
    loading,
    error: questionnaireError,
  } = useQuestionnaire(genre ?? undefined);

  const bodyQuestions = useMemo(
    () => (questionnaire?.questions ?? []).filter((q) => q.key !== 'genre'),
    [questionnaire],
  );

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const chooseGenre = (next: Genre) => {
    // 换类型：保留必答 4 项（与类型无关），清空上一类型的级联项
    if (genre !== null && genre !== next) {
      setValues((prev) => {
        const next2: Record<string, string> = {};
        for (const [key, value] of Object.entries(prev)) {
          if (!key.startsWith('extras.')) next2[key] = value;
        }
        return next2;
      });
    }
    setGenre(next);
    setStep(2);
  };

  const missingRequired = useMemo(() => {
    const missing: string[] = [];
    if (!genre) missing.push('类型');
    for (const key of REQUIRED_ANSWER_FIELDS) {
      if (key === 'genre') continue;
      if (!values[key]) missing.push(key);
    }
    return missing;
  }, [genre, values]);

  const submit = async () => {
    setSubmitError(null);
    if (!genre) return;
    const answers = answerFromValues({ ...values, genre });
    if (answers === null) {
      message.error(`还有必答项未回答：${missingRequired.join('、')}`);
      return;
    }
    const parsed = CreateProjectSchema.safeParse({ title, answers });
    if (!parsed.success) {
      message.error(parsed.error.issues[0]?.message ?? '输入不合法');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createProject(parsed.data);
      message.success('项目已创建，开始生成种子');
      void navigate(`/projects/${created.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setSubmitError(e.message);
      } else {
        setSubmitError(e instanceof Error ? e.message : '创建失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <div className="crumbs">
        <Link to="/">项目</Link> / 新建项目
      </div>
      <div className="title-row">
        <div>
          <h1>{step === 1 ? '选择类型' : '创作意图'}</h1>
          <div className="sub">
            {step === 1 ? (
              '类型决定阶段列表与问卷的级联问题'
            ) : (
              <>
                已选类型：
                <b style={{ color: 'var(--text)', fontWeight: 500 }}>
                  {genre && GENRE_LABELS[genre]}
                </b>
                （
                <a
                  onClick={() => setStep(1)}
                  style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                  返回更改
                </a>
                ）
              </>
            )}
          </div>
        </div>
      </div>

      {step === 1 && (
        <>
          <div className="field full" style={{ maxWidth: 420, marginBottom: 24 }}>
            <label htmlFor="project-title">项目标题</label>
            <Input
              id="project-title"
              value={title}
              placeholder="给你的小说起个名字"
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="genre-grid" role="listbox" aria-label="类型选择">
            {GENRES.map((item) => (
              <button
                key={item}
                type="button"
                className={`genre-card${genre === item ? ' selected' : ''}`}
                onClick={() => chooseGenre(item)}
              >
                <b>{GENRE_LABELS[item]}</b>
                <span>{GENRE_HINTS[item]}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 2 && genre !== null && (
        <div className="wizard-layout">
          <div>
            {loading && <Skeleton active paragraph={{ rows: 6 }} />}
            {questionnaireError !== null && (
              <Alert
                type="error"
                showIcon
                message="问卷加载失败"
                description={questionnaireError}
                action={
                  <Button size="small" onClick={() => setStep(1)}>
                    重新选择类型
                  </Button>
                }
              />
            )}
            {questionnaire !== null && (
              <>
                <div className="form-grid">
                  {bodyQuestions.map((question) => (
                    <div
                      key={question.key}
                      className={`field${question.key === 'idea' ? ' full' : ''}`}
                    >
                      <label>
                        {question.label}
                        {question.required && <span style={{ color: 'var(--negative)' }}> *</span>}
                      </label>
                      <QuestionControl
                        question={question}
                        value={values[question.key]}
                        onChange={(value) => setValue(question.key, value)}
                      />
                    </div>
                  ))}
                </div>
                <div className="wizard-foot">
                  <span className="hint">
                    创建后将立即生成种子；生成期间可在工作台查看进度。
                    {missingRequired.length > 0 && (
                      <span style={{ color: 'var(--negative)' }}>
                        {' '}
                        必答未完成：{missingRequired.join('、')}
                      </span>
                    )}
                  </span>
                  <span style={{ flex: 1 }} />
                  <Button onClick={() => setStep(1)}>返回上一步</Button>
                  <Button type="primary" loading={submitting} onClick={() => void submit()}>
                    创建项目，生成种子
                  </Button>
                </div>
              </>
            )}
          </div>

          <aside className="summary-rail">
            <h2>问卷摘要</h2>
            <p className="meta">这些维度由你决定，不交给模型生成</p>
            <dl className="kv">
              <dt>类型</dt>
              <dd>{genre && GENRE_LABELS[genre]}</dd>
              {bodyQuestions
                .filter((q) => q.key !== 'idea')
                .map((q) => (
                  <SummaryRow key={q.key} question={q} value={values[q.key]} />
                ))}
            </dl>
            <div className="rule" />
            <h2>生成预告</h2>
            <ol className="preview">
              <li>
                <b>种子</b>
                <span>标题、梗概、主题、主角与钩子</span>
              </li>
              <li>
                <b>世界观</b>
                <span>规则、势力与类型自定义块</span>
              </li>
              <li>
                <b>人物</b>
                <span>主角从种子扩展，含关系网</span>
              </li>
            </ol>
          </aside>
        </div>
      )}

      {submitError !== null && (
        <Alert
          type="error"
          showIcon
          message="创建被拒绝"
          description={submitError}
          style={{ marginTop: 16 }}
          closable
          onClose={() => setSubmitError(null)}
        />
      )}
    </div>
  );
}

function SummaryRow({ question, value }: { question: Question; value: string | undefined }) {
  return (
    <>
      <dt>{question.label}</dt>
      <dd>
        {value ? (
          (question.options.find((o) => o.value === value)?.label ?? value)
        ) : (
          <span style={{ color: 'var(--faint)' }}>未回答</span>
        )}
      </dd>
    </>
  );
}
