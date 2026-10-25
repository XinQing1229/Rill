import { useState } from 'react';
import { Alert, Button } from 'antd';
import type { PremiseChangePath, PremiseChangeSummary } from '@rill/shared';
import './PremiseChangeSummaryView.css';

const LABELS: Record<PremiseChangePath, string> = {
  title: '暂定书名',
  logline: '一句话梗概',
  theme: '主题',
  coreConflict: '核心冲突',
  hook: '卖点 / 钩子',
  'storyEngine.openingGoal': '故事发动机 / 开篇目标',
  'storyEngine.mainObstacle': '故事发动机 / 主要阻力',
  'storyEngine.failureCost': '故事发动机 / 失败代价',
  'storyEngine.escalationPath': '故事发动机 / 压力升级',
  'protagonist.name': '主角 / 姓名',
  'protagonist.identity': '主角 / 身份',
  'protagonist.desire': '主角 / 渴望',
  'protagonist.flaw': '主角 / 缺陷',
  'setting.era': '背景 / 时代',
  'setting.place': '背景 / 地点',
  'setting.socialBackground': '背景 / 社会环境',
  taboos: '避雷',
};

function Value({ value }: { value: string | string[] | null }) {
  if (value === null) return <p>原种子未提供</p>;
  if (Array.isArray(value))
    return value.length ? (
      <ol>
        {value.map((item, index) => (
          <li key={index}>{item || '（空内容）'}</li>
        ))}
      </ol>
    ) : (
      <p>（空列表）</p>
    );
  return <p>{value || '（空内容）'}</p>;
}

export function PremiseChangeSummaryView({
  summary,
  warning,
}: {
  summary: PremiseChangeSummary | null;
  warning?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="premise-change-summary" aria-label="本次修改">
      <h3>本次修改{summary ? ` · ${summary.changes.length} 项` : ''}</h3>
      {!summary ? (
        <Alert
          type="info"
          showIcon
          message={warning ?? '此候选生成于修改摘要功能上线前，暂无修改说明。'}
        />
      ) : summary.changes.length === 0 ? (
        <Alert type="info" showIcon message="本次未检测到字段变化，可调整建议后重试。" />
      ) : (
        <>
          <p className="hint">修改说明由 AI 生成，展开可核对实际变化。</p>
          {(expanded ? summary.changes : summary.changes.slice(0, 5)).map((change) => (
            <article key={change.path}>
              <h4>{LABELS[change.path]}</h4>
              <p>{change.description}</p>
              <details>
                <summary>查看「{LABELS[change.path]}」修改前后</summary>
                <div className="premise-change-values">
                  <div>
                    <h5>修改前</h5>
                    <Value value={change.before} />
                  </div>
                  <div>
                    <h5>修改后</h5>
                    <Value value={change.after} />
                  </div>
                </div>
              </details>
            </article>
          ))}
          {summary.changes.length > 5 && (
            <Button type="link" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? '收起其余修改项' : `展开其余 ${summary.changes.length - 5} 项`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
