import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('长描述可独立展开、收起，保持其他关系的状态', async () => {
    const user = userEvent.setup();
    render(
      <RelationList
        relations={[
          makeRelationRow('a', 'b', { description: '最初彼此试探，后来共同面对危机。'.repeat(20) }),
          makeRelationRow('a', 'c', { description: '利益联盟逐渐出现裂痕。'.repeat(20) }),
        ]}
        nameOf={(id) => ({ a: '沈青偃', b: '裴烈', c: '周平' })[id] ?? id}
      />,
    );
    const first = screen.getByRole('button', { name: '展开沈青偃与裴烈的关系描述' });
    const second = screen.getByRole('button', { name: '展开沈青偃与周平的关系描述' });
    const description = document.getElementById(first.getAttribute('aria-controls')!);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(description).not.toHaveClass('is-collapsed');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(description).toHaveClass('is-collapsed');
  });

  it('短描述完整展示且不显示展开操作', () => {
    render(<RelationList relations={[makeRelationRow('a', 'b')]} nameOf={(id) => id} />);
    expect(screen.getByText('为修复碑阵同行')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('无关系数据时展示空状态', () => {
    render(<RelationList relations={[]} nameOf={() => ''} />);
    expect(screen.getByText('还没有关系数据')).toBeInTheDocument();
  });
});
