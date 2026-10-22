import type { RelationRow } from '@rill/shared';
import { Empty, Typography } from 'antd';

interface Props {
  relations: RelationRow[];
  /** 关系双方按 id 找姓名（来自人物行） */
  nameOf: (id: string) => string;
}

/** 关系网卡片列表：从方 · 关系 · 到方 三栏，一行一卡（双方相对角色随名字展示） */
export function RelationList({ relations, nameOf }: Props) {
  if (relations.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有关系数据" />;
  }

  const party = (name: string, role: string, align: 'from' | 'to') => (
    <div className={`rel-party ${align}`}>
      <span className="rel-name">{name}</span>
      {role && <span className="sub">{role}</span>}
    </div>
  );

  return (
    <div>
      <div className="rel-head" aria-hidden="true">
        <span>从方</span>
        <span>关系</span>
        <span>到方</span>
      </div>
      <div className="rel-cards">
        {relations.map((row) => (
          <div key={row.id} className="rel-card">
            {party(nameOf(row.fromId), row.fromRole, 'from')}
            <div className="rel-main">
              {row.type && <span className="rel-pill">{row.type}</span>}
              {row.description && (
                <Typography.Paragraph
                  className="rel-desc"
                  ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}
                >
                  {row.description}
                </Typography.Paragraph>
              )}
            </div>
            {party(nameOf(row.toId), row.toRole, 'to')}
          </div>
        ))}
      </div>
    </div>
  );
}
