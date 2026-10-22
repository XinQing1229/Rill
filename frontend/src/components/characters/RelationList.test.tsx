import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RelationList } from './RelationList';
import { makeRelationRow } from '../../test/fixtures';

describe('RelationList', () => {
  it('展示双方、关系类型与相对角色', () => {
    render(
      <RelationList
        relations={[makeRelationRow('a', 'b')]}
        nameOf={(id) => (id === 'a' ? '沈青偃' : '裴烈')}
      />,
    );
    expect(screen.getByText('沈青偃')).toBeInTheDocument();
    expect(screen.getByText('裴烈')).toBeInTheDocument();
    expect(screen.getByText('同行 · 契约')).toBeInTheDocument();
    expect(screen.getByText('守碑人')).toBeInTheDocument();
  });

  it('无关系数据时展示空状态', () => {
    render(<RelationList relations={[]} nameOf={() => ''} />);
    expect(screen.getByText('还没有关系数据')).toBeInTheDocument();
  });
});
