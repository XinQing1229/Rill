import type { Premise } from '@rill/shared';

/** 种子产物按兼容读取契约展示，不自造字段；分区卡片排版（梗概铺陈 + 发动机/主角/避雷独立卡片） */
export function PremiseView({ premise }: { premise: Premise }) {
  return (
    <div>
      <div className="pv-section">
        <div className="pv-field">
          <h3>一句话梗概</h3>
          <p>{premise.logline}</p>
        </div>
        <div className="pv-field">
          <h3>主题</h3>
          <p>{premise.theme}</p>
        </div>
        <div className="pv-field">
          <h3>核心冲突</h3>
          <p>{premise.coreConflict}</p>
        </div>
        <div className="pv-field">
          <h3>时代 / 地点</h3>
          <p>
            {premise.setting.era} · {premise.setting.place}
          </p>
        </div>
        <div className="pv-field">
          <h3>社会背景</h3>
          <p>{premise.setting.socialBackground}</p>
        </div>
        <div className="pv-field">
          <h3>卖点 / 钩子</h3>
          <p>{premise.hook}</p>
        </div>
      </div>

      {premise.storyEngine && (
        <section className="pv-card">
          <div className="pv-card-head">
            <h2 className="pv-title">故事发动机</h2>
            <span className="pv-hint">目标、阻力与逐步升级的代价</span>
          </div>
          <div className="pv-row">
            <span className="pv-label">开篇目标</span>
            <p>{premise.storyEngine.openingGoal}</p>
          </div>
          <div className="pv-row">
            <span className="pv-label">主要阻力</span>
            <p>{premise.storyEngine.mainObstacle}</p>
          </div>
          <div className="pv-row">
            <span className="pv-label">失败代价</span>
            <p>{premise.storyEngine.failureCost}</p>
          </div>
          <div className="pv-row">
            <span className="pv-label">压力升级</span>
            <ol className="pv-steps">
              {premise.storyEngine.escalationPath.map((step, index) => (
                <li key={step}>
                  <span className="pv-step-num num">{index + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <section className="pv-card">
        <div className="pv-card-head">
          <h2 className="pv-title">主角</h2>
          <span className="pv-hint">完整人物设定由人物阶段扩展</span>
        </div>
        <div className="pv-row slim">
          <span className="pv-label">姓名</span>
          <p className="pv-strong">{premise.protagonist.name}</p>
        </div>
        <div className="pv-row slim">
          <span className="pv-label">身份</span>
          <p>{premise.protagonist.identity}</p>
        </div>
        <div className="pv-row slim">
          <span className="pv-label">渴望</span>
          <p>{premise.protagonist.desire}</p>
        </div>
        <div className="pv-row slim">
          <span className="pv-label">缺陷</span>
          <p>{premise.protagonist.flaw}</p>
        </div>
      </section>

      <section className="pv-card">
        <div className="pv-card-head">
          <h2 className="pv-title">避雷</h2>
          <span className="pv-hint">后续生成需要避开的内容</span>
        </div>
        <div className="pv-taboos">
          {premise.taboos.map((taboo) => (
            <span key={taboo} className="pv-taboo">
              {taboo}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
