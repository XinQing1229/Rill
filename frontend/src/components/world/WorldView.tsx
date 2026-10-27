import type { ReactNode } from 'react';
import {
  ApartmentOutlined,
  EnvironmentOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import './WorldView.css';
import { selectedGenres, type Genre, type GenreSelection } from '@rill/shared';

/** 类型自定义块的渲染注册表：键与 shared 的 CUSTOM_WORLD_SCHEMAS 对齐 */
type WorldData = Record<string, unknown>;

interface BlockProps {
  data: WorldData;
  genre: Genre;
}

function PowerSystemBlock({ data }: BlockProps) {
  const block = data.powerSystem as
    { realms?: string[]; resources?: string; cost?: string } | undefined;
  if (!block) return null;
  return (
    <div>
      <div className="block-title">
        <h3>力量体系</h3>
        <span className="meta">玄幻 · 类型自定义块</span>
      </div>
      <dl className="kv">
        <dt>境界划分</dt>
        <dd>
          <div className="tags">
            {(block.realms ?? []).map((realm) => (
              <span key={realm} className="tag">
                {realm}
              </span>
            ))}
          </div>
        </dd>
        <dt>核心资源</dt>
        <dd>{block.resources}</dd>
        <dt>代价与限制</dt>
        <dd>{block.cost}</dd>
      </dl>
    </div>
  );
}

function TechTreeBlock({ data }: BlockProps) {
  const block = data.techTree as
    { keyTech?: string[]; socialImpact?: string; limits?: string } | undefined;
  if (!block) return null;
  return (
    <div>
      <div className="block-title">
        <h3>技术树</h3>
        <span className="meta">科幻 · 类型自定义块</span>
      </div>
      <dl className="kv">
        <dt>关键技术</dt>
        <dd>
          <div className="tags">
            {(block.keyTech ?? []).map((tech) => (
              <span key={tech} className="tag">
                {tech}
              </span>
            ))}
          </div>
        </dd>
        <dt>社会影响</dt>
        <dd>{block.socialImpact}</dd>
        <dt>边界与禁忌</dt>
        <dd>{block.limits}</dd>
      </dl>
    </div>
  );
}

function InstitutionsBlock({ data }: BlockProps) {
  const block = data.institutions as
    { government?: string; military?: string; customs?: string } | undefined;
  if (!block) return null;
  return (
    <div>
      <div className="block-title">
        <h3>典章制度</h3>
        <span className="meta">历史 · 类型自定义块</span>
      </div>
      <dl className="kv">
        <dt>官制</dt>
        <dd>{block.government}</dd>
        <dt>军制</dt>
        <dd>{block.military}</dd>
        <dt>礼法风俗</dt>
        <dd>{block.customs}</dd>
      </dl>
    </div>
  );
}

function MysteryRulesBlock({ data }: BlockProps) {
  const block = data.mysteryRules as { methodBoundary?: string; revealRhythm?: string } | undefined;
  if (!block) return null;
  return (
    <div>
      <div className="block-title">
        <h3>诡计与规则</h3>
        <span className="meta">悬疑 · 类型自定义块</span>
      </div>
      <dl className="kv">
        <dt>手法边界</dt>
        <dd>{block.methodBoundary}</dd>
        <dt>揭示节奏</dt>
        <dd>{block.revealRhythm}</dd>
      </dl>
    </div>
  );
}

function IndustryBlock({ data }: BlockProps) {
  const block = data.industry as { field?: string; rules?: string } | undefined;
  if (!block) return null;
  return (
    <div>
      <div className="block-title">
        <h3>行业生态</h3>
        <span className="meta">都市 · 类型自定义块</span>
      </div>
      <dl className="kv">
        <dt>核心行业</dt>
        <dd>{block.field}</dd>
        <dt>行业规则</dt>
        <dd>{block.rules}</dd>
      </dl>
    </div>
  );
}

function RelationSettingBlock({ data }: BlockProps) {
  const block = data.relationSetting as { bond?: string; obstacle?: string } | undefined;
  if (!block) return null;
  return (
    <div>
      <div className="block-title">
        <h3>关系设定</h3>
        <span className="meta">言情 · 类型自定义块</span>
      </div>
      <dl className="kv">
        <dt>关系起点</dt>
        <dd>{block.bond}</dd>
        <dt>主要障碍</dt>
        <dd>{block.obstacle}</dd>
      </dl>
    </div>
  );
}

const CUSTOM_BLOCKS: Partial<Record<Genre, (props: BlockProps) => React.ReactNode>> = {
  xuanhuan: PowerSystemBlock,
  kehuan: TechTreeBlock,
  lishi: InstitutionsBlock,
  xuanyi: MysteryRulesBlock,
  dushi: IndustryBlock,
  yanqing: RelationSettingBlock,
};

interface Props {
  /** 已按 worldSchemaFor(genre) 校验的世界观数据 */
  world: WorldData;
  genre: GenreSelection;
  premiseSetting?: { era: string; place: string };
}

/** 世界观产物：通用骨架 + 类型自定义块；时代与地点继承自种子并标注。详细档字段按数据有无渲染 */
export function WorldView({ world, genre, premiseSetting }: Props) {
  const rules = (world.rules as Array<{ name: string; description: string }> | undefined) ?? [];
  const factions =
    (world.factions as Array<{ name: string; nature: string; stance: string }> | undefined) ?? [];
  const geography = world.geography as Array<{ name: string; description: string }> | undefined;
  const history = world.history as Array<{ event: string; impact: string }> | undefined;
  const secrets = world.secrets as Array<{ secret: string; relatedTo: string }> | undefined;

  const customGenres = selectedGenres(genre).filter((item) => CUSTOM_BLOCKS[item]);

  return (
    <div className="world-view">
      <dl className="kv wv-overview">
        <dt>世界概要</dt>
        <dd>{world.summary as string}</dd>
        {premiseSetting && (
          <>
            <dt>
              时代 / 地点
              <span className="wv-inherited">继承自种子</span>
            </dt>
            <dd>
              {premiseSetting.era} · {premiseSetting.place}
            </dd>
          </>
        )}
      </dl>

      <WorldSection title="世界规则" meta={`${rules.length} 条`} icon={<FileTextOutlined />}>
        <WorldRows
          items={rules.map((rule) => ({ title: rule.name, description: rule.description }))}
        />
      </WorldSection>

      <WorldSection title="势力" meta={`${factions.length} 方`} icon={<ApartmentOutlined />}>
        <WorldRows
          items={factions.map((faction) => ({
            title: faction.name,
            description: `${faction.nature} · ${faction.stance}`,
          }))}
        />
      </WorldSection>

      {geography && geography.length > 0 && (
        <WorldSection title="地理" meta="详细档" icon={<EnvironmentOutlined />} tone="amber">
          <WorldRows
            items={geography.map((item) => ({ title: item.name, description: item.description }))}
          />
        </WorldSection>
      )}
      {history && history.length > 0 && (
        <WorldSection title="历史" meta="详细档" icon={<FieldTimeOutlined />}>
          <WorldRows
            items={history.map((item) => ({ title: item.event, description: item.impact }))}
          />
        </WorldSection>
      )}
      {secrets && secrets.length > 0 && (
        <WorldSection title="未解之谜" meta="伏笔素材" icon={<QuestionCircleOutlined />}>
          <WorldRows
            items={secrets.map((item) => ({ title: item.secret, description: item.relatedTo }))}
          />
        </WorldSection>
      )}

      {customGenres.length ? (
        customGenres.map((item) => {
          const Renderer = CUSTOM_BLOCKS[item]!;
          return (
            <section className="wv-card wv-custom" key={item}>
              <Renderer data={world} genre={item} />
            </section>
          );
        })
      ) : (
        <div className="hint wv-empty">该类型没有自定义世界观块</div>
      )}
    </div>
  );
}

function WorldSection({
  title,
  meta,
  icon,
  tone,
  children,
}: {
  title: string;
  meta: string;
  icon: ReactNode;
  tone?: 'amber';
  children: ReactNode;
}) {
  return (
    <section className="wv-card" aria-label={title}>
      <div className="wv-card-heading">
        <span className={`wv-icon${tone ? ` wv-icon-${tone}` : ''}`} aria-hidden="true">
          {icon}
        </span>
        <h3>{title}</h3>
        <span className="wv-meta">{meta}</span>
      </div>
      {children}
    </section>
  );
}

function WorldRows({ items }: { items: Array<{ title: string; description: string }> }) {
  return items.length ? (
    <ol className="wv-rows">
      {items.map((item, index) => (
        <li key={`${index}-${item.title}`} className="wv-row">
          <span className="wv-number" aria-hidden="true">
            {index + 1}
          </span>
          <div className="wv-row-content">
            <strong>{item.title}</strong>
            <span>{item.description}</span>
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <p className="hint wv-empty">暂无内容</p>
  );
}
