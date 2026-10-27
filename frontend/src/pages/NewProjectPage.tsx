import { useMemo, useState } from 'react';
import { Alert, App, Button, Input, Select, Skeleton } from 'antd';
import {
  ArrowRightOutlined,
  BulbOutlined,
  EditOutlined,
  FileTextOutlined,
  ReadOutlined,
  SlidersOutlined,
  ThunderboltOutlined,
  UserOutlined,
  NodeIndexOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import {
  CreateProjectSchema,
  GENRE_LABELS,
  genreLabel,
  SELECTABLE_GENRES,
  DEFAULT_WRITING_STYLE,
  STORY_IDEA_MAX_LENGTH,
  REQUIRED_ANSWER_FIELDS,
  type Genre,
  type PipelineMode,
  type Question,
  type QuestionnaireAnswers,
} from '@rill/shared';
import { ApiError } from '../api/client';
import { createProject, generateStage } from '../api/novel';
import { PipelineModeSelect } from '../components/PipelineModeSelect';
import { useQuestionnaire } from '../hooks/useQuestionnaire';

const REQUIRED_FIELD_LABELS: Record<(typeof REQUIRED_ANSWER_FIELDS)[number], string> = {
  genre: '类型',
  length: '篇幅',
  pov: '叙事视角',
};

const GENRE_HINTS: Record<Genre, string> = {
  xuanhuan: '我命由我不由天',
  dushi: '冷硬如冰山，唯独对她失了分寸',
  xuanyi: '真相只有一个',
  lishi: '历史背景与制度',
  kehuan: '技术推演与边界',
  yanqing: 'baby～你就是我的唯一(♡ω♡)',
  xianxia: '激活无敌系统，神装功法一键领取',
  chaogu: '我是未成年，我要退款(╥﹏╥)',
  chuanyue: '别问我从哪来，先说现在是哪年',
  cthulhu: '你玩过元歌的诡秘之主吗',
  other: '不拘一格',
};

/** 问卷键 → 答案字段：必答项直取，extras. 前缀归入 extras */
function answerFromValues(
  values: Record<string, string>,
  genres: Genre[],
): QuestionnaireAnswers | null {
  const extras: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue;
    if (key.startsWith('extras.')) {
      if (!['extras.relation', 'extras.profession'].includes(key) && value.trim())
        extras[key.slice('extras.'.length)] = value.trim();
    }
  }
  const candidate = {
    genre: genres,
    length: values.length as QuestionnaireAnswers['length'] | undefined,
    writingStyle: { ...DEFAULT_WRITING_STYLE, id: values.writingStyle },
    idea: values.idea,
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
  const [customSelected, setCustomSelected] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const options = question.options.map((option) => ({
    label: option.label,
    value: option.value,
  }));
  const isCustom = Boolean(
    question.allowCustom &&
    (customSelected || (value && !options.some((option) => option.value === value))),
  );
  if (question.allowCustom) {
    return (
      <>
        <div className="choices" role="group" aria-label={question.label}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="choice"
              aria-pressed={!isCustom && value === option.value}
              onClick={() => {
                setCustomSelected(false);
                onChange(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className="choice"
            aria-pressed={isCustom}
            onClick={() => {
              setCustomSelected(true);
              if (!isCustom) onChange(customDraft);
            }}
          >
            自定义
          </button>
        </div>
        {isCustom && (
          <div style={{ marginTop: 12 }}>
            <label htmlFor={`custom-${question.key}`}>自定义{question.label}</label>
            <Input.TextArea
              id={`custom-${question.key}`}
              autoComplete="off"
              placeholder={`请输入你的${question.label}`}
              autoSize={{ minRows: 3, maxRows: 6 }}
              value={value ?? ''}
              onChange={(event) => {
                setCustomDraft(event.target.value);
                onChange(event.target.value);
              }}
            />
          </div>
        )}
      </>
    );
  }
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
  const [mode, setMode] = useState<PipelineMode>('manual');
  const [genre, setGenre] = useState<Genre[]>([]);
  const [values, setValues] = useState<Record<string, string>>({
    length: 'short',
    writingStyle: DEFAULT_WRITING_STYLE.id,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    data: questionnaire,
    loading,
    error: questionnaireError,
  } = useQuestionnaire(genre.length ? genre : undefined);

  const bodyQuestions = useMemo(
    () =>
      (questionnaire?.questions ?? []).filter(
        (q) => !['genre', 'idea', 'tone', 'extras.relation', 'extras.profession'].includes(q.key),
      ),
    [questionnaire],
  );

  const coreQuestions = bodyQuestions.filter((q) => !q.key.startsWith('extras.'));
  const extraQuestions = bodyQuestions.filter((q) => q.key.startsWith('extras.'));
  const previewStages = [
    '种子',
    ...(genre.length > 0 && genre.every((item) => ['dushi', 'yanqing', 'chaogu'].includes(item))
      ? []
      : ['世界观']),
    '人物',
    '关系',
    '大纲',
    '正文',
  ];
  const preferenceCount =
    (title.trim() ? 1 : 0) + extraQuestions.filter((q) => values[q.key]?.trim()).length;

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const chooseGenre = (next: Genre) => {
    setGenre((previous) =>
      previous.includes(next) ? previous.filter((item) => item !== next) : [...previous, next],
    );
    // 类型组合改变后重新选择级联偏好，保留文风等公共输入。
    setValues((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith('extras.'))),
    );
  };

  const missingRequired = useMemo(() => {
    return REQUIRED_ANSWER_FIELDS.filter((key) =>
      key === 'genre' ? genre.length === 0 : !values[key]?.trim(),
    ).map((key) => REQUIRED_FIELD_LABELS[key]);
  }, [genre, values]);

  const submit = async () => {
    setSubmitError(null);
    if (!genre.length) return;
    const answers = answerFromValues(values, genre);
    if (answers === null) {
      message.error(
        values.idea?.trim().length > STORY_IDEA_MAX_LENGTH
          ? '故事想法最多 2000 字符'
          : `还有必答项未回答：${missingRequired.join('、')}`,
      );
      return;
    }
    const parsed = CreateProjectSchema.safeParse({ title, answers, mode });
    if (!parsed.success) {
      message.error(parsed.error.issues[0]?.message ?? '输入不合法');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createProject(parsed.data);
      if (parsed.data.mode === 'auto') {
        try {
          await generateStage(created.id);
          message.success('项目已创建，已启动自动推进');
        } catch (error) {
          // 项目已创建：启动失败也进入原项目，避免重新提交产生重复项目。
          message.warning(
            `项目已创建，但自动推进启动未确认：${error instanceof Error ? error.message : '请求失败'}。请在工作台查看状态，未启动时可重试。`,
          );
        }
      } else {
        message.success('项目已创建，可在工作台开始生成');
      }
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
    <div className={`page creation-intent${step === 2 ? ' intent-details' : ''}`}>
      <div className="crumbs">
        <Link to="/">项目</Link> / 新建项目
      </div>
      <div className="title-row">
        {step === 2 && (
          <span className="intent-title-icon" aria-hidden="true">
            <EditOutlined />
          </span>
        )}
        <div>
          <h1>{step === 1 ? '选择小说类型' : '创作意图'}</h1>
          <div className="sub">
            {step === 1 ? (
              '一念起故事生'
            ) : (
              <>
                告诉我们你的想法，我们将帮你生成更贴合的内容。
                <span className="intent-selected-genre">
                  已选类型：
                  <b style={{ color: 'var(--text)', fontWeight: 500 }}>{genreLabel(genre)}</b>（
                  <button type="button" className="intent-change-genre" onClick={() => setStep(1)}>
                    返回更改
                  </button>
                  ）
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {step === 1 && (
        <>
          <div className="field full mode-section">
            <label>推进模式</label>
            <PipelineModeSelect value={mode} onChange={setMode} variant="cards" />
          </div>
          <section className="genre-section" aria-labelledby="genre-section-title">
            <div className="genre-section-head">
              <h2 id="genre-section-title">小说类型</h2>
            </div>
            <div className="genre-grid" role="group" aria-label="类型选择（可多选）">
              {SELECTABLE_GENRES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`genre-card genre-card-${item}${genre.includes(item) ? ' selected' : ''}`}
                  aria-pressed={genre.includes(item)}
                  onClick={() => chooseGenre(item)}
                >
                  <span className="genre-icon" aria-hidden="true" />
                  <span className="genre-copy">
                    <b>{GENRE_LABELS[item]}</b>
                    <span className="genre-description">{GENRE_HINTS[item]}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
          <div className="wizard-foot">
            <span className="hint" aria-live="polite">
              {genre.length ? `已选：${genreLabel(genre)}` : '请至少选择一个类型'}
            </span>
            <span style={{ flex: 1 }} />
            <Button type="primary" disabled={!genre.length} onClick={() => setStep(2)}>
              下一步
            </Button>
          </div>
        </>
      )}

      {step === 2 && genre.length > 0 && (
        <div className="wizard-layout">
          <div className="intent-form">
            <div className="intent-tip" id="story-idea-help">
              <BulbOutlined aria-hidden="true" />
              <span>
                可以简单描述故事背景、人物、风格或你希望尝试的方向，越具体越好。留空时，根据你选择的类型和写法构思。
              </span>
            </div>
            <div className="field full intent-story">
              <label htmlFor="story-idea">你想写什么故事？（选填）</label>
              <Input.TextArea
                id="story-idea"
                value={values.idea ?? ''}
                onChange={(event) => setValue('idea', event.target.value)}
                placeholder="例如：一个男大学生在股市做短线，从一万元本金起步，最终赚到一个亿。"
                autoSize={{ minRows: 6, maxRows: 12 }}
                count={{ max: STORY_IDEA_MAX_LENGTH }}
                status={
                  (values.idea?.trim().length ?? 0) > STORY_IDEA_MAX_LENGTH ? 'error' : undefined
                }
                aria-invalid={(values.idea?.trim().length ?? 0) > STORY_IDEA_MAX_LENGTH}
                showCount
                aria-describedby="story-idea-help"
              />
              {(values.idea?.trim().length ?? 0) > STORY_IDEA_MAX_LENGTH && (
                <p role="alert" style={{ color: 'var(--negative)' }}>
                  故事想法最多 2000 字符，请精简后再创建。
                </p>
              )}
            </div>
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
                <h2 className="intent-section-title">
                  <FileTextOutlined aria-hidden="true" />
                  希望怎么写
                </h2>
                <div className="form-grid">
                  {coreQuestions.map((question) => (
                    <div
                      key={question.key}
                      className={`field${question.key === 'writingStyle' ? ' full' : ''}`}
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
                      {question.key === 'writingStyle' && (
                        <p className="hint">语言直白，冲突前置，推进紧凑，反击有实际结果。</p>
                      )}
                    </div>
                  ))}
                </div>
                <details className="intent-preferences">
                  <summary>
                    更多偏好（选填）{preferenceCount > 0 ? ` · 已填 ${preferenceCount} 项` : ''}
                  </summary>
                  <div className="field full" style={{ margin: '16px 0 24px' }}>
                    <label htmlFor="project-title">书名（选填）</label>
                    <Input
                      id="project-title"
                      autoComplete="off"
                      value={title}
                      placeholder="已有书名可以填写"
                      status={title.trim().length > 100 ? 'error' : undefined}
                      aria-invalid={title.trim().length > 100}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                    {title.trim().length > 100 && (
                      <p role="alert" style={{ color: 'var(--negative)' }}>
                        书名最多 100 字符，请精简后再创建。
                      </p>
                    )}
                    <p className="hint">留空时根据故事生成暂定书名。</p>
                  </div>
                  <div className="form-grid">
                    {extraQuestions.map((question) => (
                      <div className="field" key={question.key}>
                        <label>{question.label}</label>
                        <QuestionControl
                          question={question}
                          value={values[question.key]}
                          onChange={(value) => setValue(question.key, value)}
                        />
                      </div>
                    ))}
                  </div>
                </details>
                <div className="wizard-foot">
                  <span className="hint intent-submit-hint">
                    {mode === 'manual'
                      ? '创建后在工作台开始生成，每阶段确认后继续。'
                      : '创建后立即启动自动推进，正文仍需逐章接受。'}
                    {missingRequired.length > 0 && (
                      <span style={{ color: 'var(--negative)' }}>
                        {' '}
                        还需填写：{missingRequired.join('、')}
                      </span>
                    )}
                  </span>
                  <span style={{ flex: 1 }} />
                  <Button onClick={() => setStep(1)}>返回上一步</Button>
                  <Button type="primary" loading={submitting} onClick={() => void submit()}>
                    {mode === 'auto' ? '创建项目并自动推进' : '创建项目'}
                    <ArrowRightOutlined aria-hidden="true" />
                  </Button>
                </div>
              </>
            )}
          </div>

          <aside className="summary-rail">
            <div className="intent-summary-heading">
              <span className="intent-summary-icon" aria-hidden="true">
                <ThunderboltOutlined />
              </span>
              <div>
                <h2>本次创作设定</h2>
                <p className="meta">基于你的选择生成创作方案</p>
              </div>
            </div>
            <section className="intent-summary-card">
              <div className="intent-story-preview">
                <h3>故事想法</h3>
                <div>
                  {values.idea?.trim() ? (
                    values.idea.trim().length <= 100 ? (
                      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {values.idea.trim()}
                      </p>
                    ) : (
                      <details>
                        <summary
                          style={{
                            cursor: 'pointer',
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {values.idea.trim().slice(0, 100)}
                          {values.idea.trim().length > 100 ? '…（展开原文）' : ''}
                        </summary>
                        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {values.idea.trim()}
                        </p>
                      </details>
                    )
                  ) : (
                    <p className="hint">由 AI 根据所选设定构思</p>
                  )}
                </div>
              </div>
              <dl className="kv">
                <dt>书名</dt>
                <dd>{title.trim() || '根据故事生成'}</dd>
                <dt>类型</dt>
                <dd>{genreLabel(genre)}</dd>
                {bodyQuestions
                  .filter((q) => !q.key.startsWith('extras.') || values[q.key]?.trim())
                  .map((q) => (
                    <SummaryRow key={q.key} question={q} value={values[q.key]} />
                  ))}
              </dl>
            </section>
            <section className="intent-summary-card intent-mode-card">
              <h2>
                <SlidersOutlined aria-hidden="true" />
                创作模式
              </h2>
              <div className="intent-mode-description">
                <span className="intent-mode-icon" aria-hidden="true">
                  <NodeIndexOutlined />
                </span>
                <div>
                  <p>{mode === 'manual' ? '手动推进' : '自动推进'}</p>
                  <p className="hint">
                    {mode === 'manual' ? '每阶段确认后继续' : '连续生成，正文逐章人工接受'}
                  </p>
                </div>
              </div>
            </section>
            <section className="intent-summary-card intent-preview-card">
              <h2>
                <ReadOutlined aria-hidden="true" />
                生成要素参考
              </h2>
              <ol className="preview">
                {previewStages.map((stage) => (
                  <li key={stage}>
                    <span className="intent-stage-icon" aria-hidden="true">
                      {stage === '种子' || stage === '正文' ? (
                        <FileTextOutlined />
                      ) : stage === '人物' || stage === '关系' ? (
                        <UserOutlined />
                      ) : (
                        <ApartmentOutlined />
                      )}
                    </span>
                    <div>
                      <b>{stage}</b>
                      {stage === '种子' && <span>书名、梗概、主角与冲突</span>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
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
