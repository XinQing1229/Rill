import type { Premise } from '@rill/shared';

/** 种子产物按兼容读取契约展示，不自造字段 */
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

      {premise.storyEngine && (
        <>
          <div className="block-title">
            <h3>故事发动机</h3>
            <span className="meta">目标、阻力与逐步升级的代价</span>
          </div>
          <dl className="kv wide-lead">
            <dt>开篇目标</dt>
            <dd>{premise.storyEngine.openingGoal}</dd>
            <dt>主要阻力</dt>
            <dd>{premise.storyEngine.mainObstacle}</dd>
            <dt>失败代价</dt>
            <dd>{premise.storyEngine.failureCost}</dd>
            <dt>压力升级</dt>
            <dd>
              <ol>
                {premise.storyEngine.escalationPath.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </dd>
          </dl>
        </>
      )}

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
