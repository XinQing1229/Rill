import { useId, useState } from 'react';
import type { RelationRow } from '@rill/shared';
import { BarChartOutlined, DownOutlined, UpOutlined, DisconnectOutlined } from '@ant-design/icons';
import { Empty } from 'antd';
import './RelationList.css';

interface Props {
  relations: RelationRow[];
  /** 关系双方按 id 找姓名（来自人物行） */
  nameOf: (id: string) => string;
}

function RelationCard({ row, nameOf }: { row: RelationRow; nameOf: Props['nameOf'] }) {
  const [expanded, setExpanded] = useState(false);
  const descriptionId = useId();
  const fromName = nameOf(row.fromId);
  const toName = nameOf(row.toId);
  const isLong = row.description.length > 160;

  const tone = /仇|敌|对立|敌对/.test(row.type)
    ? 'hostile'
    : /利益|合作|盟友|同盟/.test(row.type)
      ? 'benefit'
      : 'neutral';
  const party = (name: string, role: string, side: string) => (
    <div className={`relation-party ${side}`}>
      <span className="relation-name">{name}</span>
      {role && <span className="relation-role">{role}</span>}
    </div>
  );

  return (
    <article className={`relation-card ${tone}`} aria-label={`${fromName}与${toName}的关系`}>
      {party(fromName, row.fromRole, 'from')}
      <div className="relation-body">
        <div className="relation-main">
          {row.type && (
            <span className="relation-type">
              {tone === 'hostile' && <DisconnectOutlined />}
              {tone === 'benefit' && <BarChartOutlined />}
              {row.type}
            </span>
          )}
          {row.description && (
            <div className={`relation-story${isLong && !expanded ? ' is-collapsed' : ''}`}>
              <p
                id={descriptionId}
                className={`relation-description${isLong && !expanded ? ' is-collapsed' : ''}`}
              >
                {row.description}
              </p>
              {isLong && (
                <button
                  type="button"
                  className="relation-toggle"
                  aria-expanded={expanded}
                  aria-controls={descriptionId}
                  aria-label={`${expanded ? '收起' : '展开'}${fromName}与${toName}的关系描述`}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? '收起' : '展开'}
                  {expanded ? <UpOutlined /> : <DownOutlined />}
                </button>
              )}
            </div>
          )}
        </div>
        {party(toName, row.toRole, 'to')}
      </div>
    </article>
  );
}

/** 从方、关系描述、到方三栏展示，长文支持展开与收起。 */
export function RelationList({ relations, nameOf }: Props) {
  if (relations.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有关系数据" />;
  }

  return (
    <div className="relation-list">
      <div className="relation-head" aria-hidden="true">
        <span>从方</span>
        <span>关系</span>
        <span>到方</span>
      </div>
      <div className="relation-cards">
        {relations.map((row) => (
          <RelationCard key={row.id} row={row} nameOf={nameOf} />
        ))}
      </div>
    </div>
  );
}
