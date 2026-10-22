import type { Premise } from '@rill/shared';

/** 种子产物：严格按 PremiseSchema 结构展示，不自造字段 */
export function PremiseView({ premise }: { premise: Premise }) {
  return (
    <div>
      <dl className="kv">
        <dt>一句话梗概</dt>
        <dd>{premise.logline}</dd>
        <dt>主题</dt>
        <dd>{premise.theme}</dd>
        <dt>核心冲突</dt>
        <dd>{premise.coreConflict}</dd>
        <dt>时代 / 地点</dt>
        <dd>
          {premise.setting.era} · {premise.setting.place}
        </dd>
        <dt>社会背景</dt>
        <dd>{premise.setting.socialBackground}</dd>
        <dt>卖点 / 钩子</dt>
        <dd>{premise.hook}</dd>
      </dl>

      <div className="block-title">
        <h3>主角</h3>
        <span className="meta">完整人物设定由人物阶段扩展</span>
      </div>
      <dl className="kv wide-lead">
        <dt>姓名</dt>
        <dd>{premise.protagonist.name}</dd>
        <dt>身份</dt>
        <dd>{premise.protagonist.identity}</dd>
        <dt>渴望</dt>
        <dd>{premise.protagonist.desire}</dd>
        <dt>缺陷</dt>
        <dd>{premise.protagonist.flaw}</dd>
      </dl>

      <div className="block-title">
        <h3>避雷</h3>
        <span className="meta">后续生成需要避开的内容</span>
      </div>
      <div className="tags">
        {premise.taboos.map((taboo) => (
          <span key={taboo} className="tag">
            {taboo}
          </span>
        ))}
      </div>
    </div>
  );
}
