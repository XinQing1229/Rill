import { CloseOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
} from 'antd';
import {
  ChapterSummarySchema,
  OutlinePlanSchema,
  type ChapterSummary,
  type OutlineDetail,
  type OutlinePlan,
  type ProjectDetail,
} from '@rill/shared';
import { firstUnreadyUpstream, upstreamBlockLabel } from '../../lib/stage';
import {
  configureOutline,
  confirmOutline,
  generateStage,
  getOutline,
  saveOutlineChapter,
  saveOutlinePlan,
} from '../../api/novel';

const stepIndex = { planning: 0, plan_review: 1, expanding: 2, outline_review: 3, confirmed: 4 };
const labels = { mainline: '全书主线', climax: '高潮', ending: '结局' } as const;
const chapterLabels = {
  title: '章名',
  events: '主要事件',
  conflict: '本章冲突',
  outcome: '冲突结果',
  consequence: '对后续的影响',
  foreshadowing: '伏笔（可选）',
  relationChange: '关系变化（可选）',
} as const;

/** 只挂载正在编辑的单章表单，长篇其余章节按剧情段回看。 */
export function OutlineWorkbench({
  project,
  onChanged,
  onRollback,
}: {
  project: ProjectDetail;
  onChanged?: () => void;
  onRollback: () => void;
}) {
  const [detail, setDetail] = useState<OutlineDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [dirtyPlan, setDirtyPlan] = useState(false);
  const [dirtyChapter, setDirtyChapter] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [planForm] = Form.useForm<OutlinePlan>();
  const [chapterForm] = Form.useForm<ChapterSummary>();
  const { modal, message } = App.useApp();
  const running = project.status === 'running';
  const upstreamBlock = firstUnreadyUpstream(project, 'outline');
  const readonly = project.currentStage !== 'outline' || running || busy;
  const dirty = dirtyPlan || dirtyChapter || (detail !== null && target !== detail.targetChapters);

  useEffect(() => {
    let cancelled = false;
    if (!dirty)
      void getOutline(project.id)
        .then((data) => {
          if (cancelled) return;
          setDetail(data);
          setTarget(data.targetChapters);
          if (data.plan) planForm.setFieldsValue(data.plan);
          const chapter = data.chapters.find((c) => c.number === selected);
          if (chapter) chapterForm.setFieldsValue(chapter);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : '加载大纲失败');
        });
    return () => {
      cancelled = true;
    };
  }, [
    project.id,
    project.updatedAt,
    project.outlineProgress?.revision,
    reloadVersion,
    dirty,
    planForm,
    chapterForm,
    selected,
  ]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    onChanged?.();
    try {
      await action();
      const data = await getOutline(project.id);
      setDetail(data);
      setTarget(data.targetChapters);
      setDirtyPlan(false);
      setDirtyChapter(false);
      planForm.resetFields();
      if (data.plan) planForm.setFieldsValue(data.plan);
      const chapter = data.chapters.find((c) => c.number === selected);
      if (chapter) chapterForm.setFieldsValue(chapter);
      message.success(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败；输入已保留');
    } finally {
      setBusy(false);
      onChanged?.();
    }
  }

  const withImpact = (action: () => void) => {
    if (detail && (detail.completedChapters > 0 || detail.staleChapters.length > 0))
      modal.confirm({
        title: '修改规划将使章纲与下游失效',
        content: '已有章纲可回看，但需重新生成；细纲和正文也将失效。继续保存？',
        onOk: action,
      });
    else action();
  };
  const validate = <T,>(parsed: {
    success: boolean;
    data?: T;
    error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
  }): T | null => {
    if (parsed.success) return parsed.data!;
    setError(
      parsed.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；') ??
        '请检查表单',
    );
    return null;
  };

  if (!detail)
    return (
      <div className="node">
        {error ? <Alert type="error" message={error} /> : <Spin aria-label="加载大纲" />}
      </div>
    );
  const options = project.characters
    .filter((c) => !c.stale && c.status === 'done')
    .map((c) => ({ value: c.id, label: c.name }));
  const selectable = detail.chapters.map((c) => ({
    value: c.number,
    label: `第 ${c.number} 章 · ${c.title}`,
  }));
  const failedBatches = detail.batches.filter((batch) => batch.status === 'failed');

  return (
    <section className="node" aria-label="大纲工作台">
      <header>
        <h2>大纲</h2>
        <Tag>
          {detail.step === 'confirmed'
            ? '已确认'
            : detail.step === 'plan_review'
              ? '规划待确认'
              : detail.step === 'outline_review'
                ? '完整大纲待确认'
                : running
                  ? '生成中'
                  : '待生成 / 可续跑'}
        </Tag>
      </header>
      <Steps
        size="small"
        current={stepIndex[detail.step]}
        items={['全书规划', '确认规划', '展开章纲', '确认完整大纲', '完成'].map((title) => ({
          title,
        }))}
        style={{ margin: '20px 0' }}
      />
      <p aria-live="polite">
        已完成 {detail.completedChapters} / {detail.targetChapters} 章 · {detail.completedBatches} /{' '}
        {detail.totalBatches} 批
      </p>
      {(error || detail.error) && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message={error ?? detail.error}
          description="输入已保留。失败批次可续跑；版本冲突时请核对服务器最新内容。"
          style={{ marginBottom: 16 }}
        />
      )}
      {failedBatches.length > 0 && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message={`${failedBatches.length} 个批次尚未生成成功`}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {failedBatches.map((batch) => (
                <li key={`${batch.startChapter}-${batch.endChapter}`}>
                  第 {batch.startChapter}–{batch.endChapter} 章：
                  {batch.error ?? '未知错误'}
                </li>
              ))}
            </ul>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      {upstreamBlock && (
        <Alert
          type="warning"
          message={`${upstreamBlockLabel(upstreamBlock)}，完成后才能生成大纲。`}
        />
      )}
      {detail.stale && <Alert type="warning" message="上游已变更，大纲失效，需重新生成后确认" />}
      {dirty && (
        <Alert type="info" message="有未保存修改，请先保存再确认" style={{ marginBottom: 12 }} />
      )}
      {project.currentStage !== 'outline' && (
        <Button onClick={onRollback} disabled={running || busy}>
          回退到大纲后编辑
        </Button>
      )}
      <Space wrap style={{ margin: '16px 0' }}>
        <label htmlFor="outline-target">目标章数</label>
        <InputNumber
          id="outline-target"
          min={1}
          precision={0}
          value={target}
          onChange={setTarget}
          disabled={readonly}
        />
        <Button
          disabled={
            readonly ||
            target === null ||
            target === detail.targetChapters ||
            dirtyPlan ||
            dirtyChapter
          }
          onClick={() =>
            withImpact(
              () =>
                void act(
                  () => configureOutline(project.id, detail.revision, target!),
                  '目标章数已保存，请生成规划',
                ),
            )
          }
        >
          保存章数
        </Button>
        <Button
          disabled={readonly || dirty || !!upstreamBlock}
          loading={busy}
          onClick={() => void act(() => generateStage(project.id), '已启动，将从未完成步骤继续')}
        >
          {detail.error ? '续跑失败步骤' : '生成 / 继续'}
        </Button>
        <Button
          disabled={running || busy}
          onClick={() =>
            modal.confirm({
              title: '载入最新内容？',
              content: '将放弃本地未保存修改。',
              onOk: () => {
                setError(null);
                setDirtyPlan(false);
                setDirtyChapter(false);
                setTarget(detail.targetChapters);
                setReloadVersion((value) => value + 1);
                onChanged?.();
              },
            })
          }
        >
          载入最新内容
        </Button>
        <Button
          disabled={readonly || dirty || !!upstreamBlock}
          onClick={() =>
            modal.confirm({
              title: '从规划重新生成？',
              content: '现有章纲及下游将失效。',
              onOk: () =>
                void act(() => generateStage(project.id, { force: true }), '已启动重新生成'),
            })
          }
        >
          重新生成全书规划
        </Button>
      </Space>

      {detail.plan && (
        <Collapse
          defaultActiveKey={['plan']}
          items={[
            {
              key: 'plan',
              label: (
                <span className="panel-head">
                  <span className="panel-title">全书规划</span>
                  <span
                    className={
                      detail.planConfirmedRevision === detail.planRevision
                        ? 'panel-tag done'
                        : 'panel-tag pending'
                    }
                  >
                    {detail.planConfirmedRevision === detail.planRevision ? '已确认' : '待确认'}
                  </span>
                  {dirtyPlan && <span className="panel-tag dirty">有未保存修改</span>}
                  <span className="panel-hint">展开可直接编辑并保存</span>
                </span>
              ),
              children: (
                <Form
                  form={planForm}
                  layout="vertical"
                  disabled={readonly}
                  initialValues={detail.plan}
                  onValuesChange={() => setDirtyPlan(true)}
                >
                  {Object.entries(labels).map(([name, label]) => (
                    <Form.Item
                      key={name}
                      name={name}
                      label={label}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
                    </Form.Item>
                  ))}
                  <Form.List name="turningPoints">
                    {(fields, { add, remove }) => (
                      <div className="turn-card">
                        <div className="turn-card-head">
                          <span>主要转折</span>
                          <span className="panel-hint">按故事推进顺序列出</span>
                        </div>
                        <div className="turn-grid">
                          {fields.map((field) => (
                            <div key={field.key} className="turn-cell">
                              <Form.Item
                                name={field.name}
                                label={`转折 ${field.name + 1}`}
                                rules={[{ required: true }]}
                              >
                                <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
                              </Form.Item>
                              <Button
                                className="turn-remove"
                                type="text"
                                size="small"
                                aria-label={`移除转折 ${field.name + 1}`}
                                icon={<CloseOutlined />}
                                onClick={() => remove(field.name)}
                              />
                            </div>
                          ))}
                        </div>
                        <Button onClick={() => add('')}>增加转折</Button>
                      </div>
                    )}
                  </Form.List>
                  <Form.List name="characterArcs">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map((field) => (
                          <div key={field.key} className="arc-card">
                            <div className="arc-head">
                              <Form.Item
                                name={[field.name, 'characterId']}
                                label="人物弧光：人物"
                                rules={[{ required: true }]}
                              >
                                <Select options={options} style={{ minWidth: 220 }} />
                              </Form.Item>
                              <Button onClick={() => remove(field.name)}>移除人物弧光</Button>
                            </div>
                            <Form.Item
                              name={[field.name, 'development']}
                              label="人物发展"
                              rules={[{ required: true }]}
                            >
                              <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
                            </Form.Item>
                          </div>
                        ))}
                        <Button onClick={() => add({})}>增加人物弧光</Button>
                      </>
                    )}
                  </Form.List>
                  <Form.List name="relationDevelopments">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map((field) => (
                          <div key={field.key}>
                            <Space>
                              <Form.Item name={[field.name, 'fromId']} label="关系一方">
                                <Select style={{ minWidth: 140 }} options={options} />
                              </Form.Item>
                              <Form.Item name={[field.name, 'toId']} label="关系另一方">
                                <Select style={{ minWidth: 140 }} options={options} />
                              </Form.Item>
                            </Space>
                            <Form.Item name={[field.name, 'development']} label="关系发展">
                              <Input.TextArea />
                            </Form.Item>
                            <Button onClick={() => remove(field.name)}>移除关系发展</Button>
                          </div>
                        ))}
                        <Button onClick={() => add({})}>增加关系发展</Button>
                      </>
                    )}
                  </Form.List>
                  <Form.List name="segments">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map((field) => (
                          <fieldset key={field.key} className="seg-card">
                            <legend>剧情段 {field.name + 1}</legend>
                            <div className="seg-row">
                              <Form.Item
                                name={[field.name, 'id']}
                                label="剧情段标识"
                                rules={[{ required: true }]}
                              >
                                <Input />
                              </Form.Item>
                              <Form.Item
                                name={[field.name, 'title']}
                                label="标题"
                                rules={[{ required: true }]}
                              >
                                <Input />
                              </Form.Item>
                            </div>
                            {(['goal', 'events', 'outcome'] as const).map((name, index) => (
                              <Form.Item
                                key={name}
                                name={[field.name, name]}
                                label={['故事目标', '核心事件', '结果'][index]}
                                rules={[{ required: true }]}
                              >
                                <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
                              </Form.Item>
                            ))}
                            <div className="seg-foot">
                              <Form.Item
                                name={[field.name, 'startChapter']}
                                label="起始章"
                                rules={[{ required: true }]}
                              >
                                <InputNumber min={1} precision={0} style={{ width: 120 }} />
                              </Form.Item>
                              <Form.Item
                                name={[field.name, 'endChapter']}
                                label="结束章"
                                rules={[{ required: true }]}
                              >
                                <InputNumber min={1} precision={0} style={{ width: 120 }} />
                              </Form.Item>
                              <Button onClick={() => remove(field.name)}>移除剧情段</Button>
                            </div>
                          </fieldset>
                        ))}
                        <Button onClick={() => add({})}>增加剧情段</Button>
                      </>
                    )}
                  </Form.List>
                  <Button
                    type="primary"
                    disabled={
                      readonly || !dirtyPlan || dirtyChapter || target !== detail.targetChapters
                    }
                    style={{ marginTop: 16 }}
                    onClick={async () => {
                      const plan = validate(
                        OutlinePlanSchema.safeParse(planForm.getFieldsValue(true)),
                      );
                      if (plan)
                        withImpact(
                          () =>
                            void act(
                              () => saveOutlinePlan(project.id, detail.revision, plan),
                              '全书规划已保存，等待确认',
                            ),
                        );
                    }}
                  >
                    保存全书规划
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      )}
      {detail.chapters.length > 0 && (
        <Collapse
          defaultActiveKey={['chapters']}
          items={[
            {
              key: 'chapters',
              label: (
                <span className="panel-head">
                  <span className="panel-title">每章概要</span>
                  <span
                    className={
                      detail.completedChapters === detail.targetChapters
                        ? 'panel-tag done'
                        : 'panel-tag'
                    }
                  >
                    {detail.completedChapters} / {detail.targetChapters} 章
                  </span>
                  {detail.stale && <span className="panel-tag dirty">已失效</span>}
                  {dirtyChapter && <span className="panel-tag dirty">有未保存修改</span>}
                  <span className="panel-hint">展开选择章节编辑</span>
                </span>
              ),
              children: (
                <>
                  <Select
                    aria-label="选择编辑章节"
                    options={selectable}
                    value={selected}
                    showSearch
                    optionFilterProp="label"
                    style={{ width: '100%', marginBottom: 16 }}
                    disabled={dirtyChapter}
                    onChange={(number) => {
                      setSelected(number);
                      const chapter = detail.chapters.find((c) => c.number === number);
                      chapterForm.resetFields();
                      if (chapter) chapterForm.setFieldsValue(chapter);
                    }}
                  />
                  {selected !== null && (
                    <Form
                      form={chapterForm}
                      layout="vertical"
                      disabled={readonly || detail.stale}
                      onValuesChange={() => setDirtyChapter(true)}
                    >
                      {Object.entries(chapterLabels).map(([name, label]) => (
                        <Form.Item
                          key={name}
                          name={name}
                          label={label}
                          rules={
                            ['foreshadowing', 'relationChange'].includes(name)
                              ? []
                              : [{ required: true, whitespace: true }]
                          }
                        >
                          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
                        </Form.Item>
                      ))}
                      <Form.Item name="characterIds" label="参与人物" rules={[{ required: true }]}>
                        <Select mode="multiple" options={options} />
                      </Form.Item>
                      <Button
                        type="primary"
                        disabled={readonly || !dirtyChapter || dirtyPlan || detail.stale}
                        onClick={() => {
                          const original = detail.chapters.find((c) => c.number === selected)!;
                          const chapter = validate(
                            ChapterSummarySchema.safeParse({
                              ...original,
                              ...chapterForm.getFieldsValue(true),
                            }),
                          );
                          if (chapter)
                            void act(
                              () => saveOutlineChapter(project.id, detail.revision, chapter),
                              '章纲已保存，完整大纲等待确认',
                            );
                        }}
                      >
                        保存本章概要
                      </Button>
                    </Form>
                  )}
                  <Collapse
                    style={{ marginTop: 16 }}
                    items={detail.plan?.segments.map((segment) => ({
                      key: segment.id,
                      label: `${segment.title} · 第 ${segment.startChapter}–${segment.endChapter} 章`,
                      children: detail.chapters
                        .filter((c) => c.segmentId === segment.id)
                        .map((chapter) => (
                          <article key={chapter.number}>
                            <h4>
                              {chapter.number}. {chapter.title}
                            </h4>
                            <p>{chapter.events}</p>
                            <p>
                              冲突：{chapter.conflict}；结果：{chapter.outcome}
                            </p>
                            <p>后续：{chapter.consequence}</p>
                          </article>
                        )),
                    }))}
                  />
                </>
              ),
            },
          ]}
        />
      )}
      {detail.staleChapters.length > 0 && (
        <Collapse
          style={{ marginTop: 16 }}
          items={[
            {
              key: 'stale',
              label: `失效章纲回看（${detail.staleChapters.length} 章，不参与确认）`,
              children: detail.staleChapters.map((chapter, index) => (
                <p key={index}>
                  {chapter.number}. {chapter.title}：{chapter.events}
                </p>
              )),
            },
          ]}
        />
      )}
      <Space style={{ marginTop: 24 }}>
        {detail.step === 'plan_review' && (
          <Button
            type="primary"
            disabled={readonly || dirty || detail.stale}
            onClick={() =>
              void act(
                () =>
                  confirmOutline(project.id, {
                    target: 'outline-plan',
                    expectedRevision: detail.revision,
                  }),
                '已确认规划并展开章纲',
              )
            }
          >
            确认规划并展开章纲
          </Button>
        )}
        {(detail.step === 'outline_review' || detail.step === 'confirmed') && (
          <Button
            type="primary"
            disabled={
              readonly ||
              dirty ||
              detail.stale ||
              detail.completedChapters !== detail.targetChapters
            }
            onClick={() =>
              void act(
                () =>
                  confirmOutline(project.id, {
                    target: 'outline',
                    expectedRevision: detail.revision,
                  }),
                '完整大纲已确认',
              )
            }
          >
            {detail.step === 'confirmed' ? '沿用已确认大纲并进入细纲' : '确认完整大纲并进入细纲'}
          </Button>
        )}
      </Space>
    </section>
  );
}
