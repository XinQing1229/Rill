import {
  AimOutlined,
  BarChartOutlined,
  CloseOutlined,
  EnvironmentOutlined,
  FireOutlined,
  HeartOutlined,
  IdcardOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { Premise } from '@rill/shared';
import './PremiseView.css';

/** 种子与候选共用字段布局，兼容不含故事发动机的历史产物。 */
export function PremiseView({ premise }: { premise: Premise }) {
  const fields = [
    { label: '一句话梗概', value: premise.logline, icon: StarOutlined },
    { label: '主题', value: premise.theme, icon: AimOutlined },
    { label: '核心冲突', value: premise.coreConflict, icon: ThunderboltOutlined },
    {
      label: '时代 / 地点',
      value: `${premise.setting.era} · ${premise.setting.place}`,
      icon: EnvironmentOutlined,
    },
    { label: '社会背景', value: premise.setting.socialBackground, icon: TeamOutlined },
    { label: '卖点 / 钩子', value: premise.hook, icon: BarChartOutlined },
  ];
  const protagonistFields = [
    { label: '姓名', value: premise.protagonist.name, icon: IdcardOutlined, tone: 'blue' },
    { label: '身份', value: premise.protagonist.identity, icon: ReadOutlined, tone: 'green' },
    { label: '渴望', value: premise.protagonist.desire, icon: FireOutlined, tone: 'orange' },
    { label: '缺陷', value: premise.protagonist.flaw, icon: HeartOutlined, tone: 'red' },
  ];

  return (
    <div className="premise-view">
      <dl className="pv-overview">
        {fields.map(({ label, value, icon: Icon }) => (
          <div className="pv-overview-field" key={label}>
            <dt>
              <Icon aria-hidden="true" />
              {label}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {premise.storyEngine && (
        <section className="pv-card pv-engine" aria-label="故事发动机">
          <div className="pv-card-head">
            <AimOutlined className="pv-section-icon" aria-hidden="true" />
            <h2 className="pv-title">故事发动机</h2>
            <span className="pv-hint">目标、阻力与逐步升级的代价</span>
          </div>
          <dl className="pv-engine-body">
            <div className="pv-engine-row">
              <dt>开篇目标</dt>
              <dd>{premise.storyEngine.openingGoal}</dd>
            </div>
            <div className="pv-engine-row">
              <dt>主要阻力</dt>
              <dd>{premise.storyEngine.mainObstacle}</dd>
            </div>
            <div className="pv-engine-row">
              <dt>失败代价</dt>
              <dd>{premise.storyEngine.failureCost}</dd>
            </div>
            <div className="pv-engine-row">
              <dt>压力升级</dt>
              <dd>
                <ol className="pv-steps">
                  {premise.storyEngine.escalationPath.map((step, index) => (
                    <li key={step}>
                      <span className="pv-step-num num" aria-hidden="true">
                        {index + 1}
                      </span>
                      <p>{step}</p>
                    </li>
                  ))}
                </ol>
              </dd>
            </div>
          </dl>
        </section>
      )}

      <section className="pv-card pv-protagonist" aria-label="主角">
        <div className="pv-card-head">
          <UserOutlined className="pv-section-icon" aria-hidden="true" />
          <h2 className="pv-title">主角</h2>
          <span className="pv-hint">完整人物设定由人物阶段扩展</span>
        </div>
        <dl className="pv-protagonist-grid">
          {protagonistFields.map(({ label, value, icon: Icon, tone }) => (
            <div className={`pv-person-field pv-person-${tone}`} key={label}>
              <span className="pv-person-icon" aria-hidden="true">
                <Icon />
              </span>
              <div className="pv-person-copy">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>

      <section className="pv-card pv-avoid" aria-label="避雷">
        <div className="pv-card-head">
          <SafetyCertificateOutlined className="pv-section-icon" aria-hidden="true" />
          <h2 className="pv-title">避雷</h2>
          <span className="pv-hint">后续生成需要避开的内容</span>
        </div>
        <ul className="pv-taboos">
          {premise.taboos.map((taboo) => (
            <li key={taboo} className="pv-taboo">
              <CloseOutlined aria-hidden="true" />
              <span>{taboo}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
