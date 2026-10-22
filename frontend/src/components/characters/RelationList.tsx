import type { RelationRow } from '@rill/shared';
import { Empty, Table } from 'antd';

interface Props {
  relations: RelationRow[];
  /** 关系双方按 id 找姓名（来自人物行） */
  nameOf: (id: string) => string;
}

/** 关系网表格：从方、关系类型、到方（双方相对角色随名字展示） */
export function RelationList({ relations, nameOf }: Props) {
  return (
    <Table<RelationRow>
      size="small"
      rowKey="id"
      dataSource={relations}
      pagination={false}
      locale={{
        emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有关系数据" />,
      }}
      columns={[
        {
          title: '从方',
          render: (_, row) => (
            <span>
              {nameOf(row.fromId)}
              <span className="sub">{row.fromRole}</span>
            </span>
          ),
        },
        {
          title: '关系',
          render: (_, row) => (
            <span>
              {row.type}
              <span className="sub">{row.description}</span>
            </span>
          ),
        },
        {
          title: '到方',
          render: (_, row) => (
            <span>
              {nameOf(row.toId)}
              <span className="sub">{row.toRole}</span>
            </span>
          ),
        },
      ]}
    />
  );
}
