import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CharacterView } from './CharacterView';
import { makeCharacterRow } from '../../test/fixtures';

describe('CharacterView', () => {
  it('人物卡展示契约字段且主角置顶标识', () => {
    const rows = [
      makeCharacterRow('沈青偃', 'protagonist'),
      makeCharacterRow('裴烈', 'supporting'),
    ];
    const { container } = render(<CharacterView rows={rows} />);
    expect(screen.getByText('沈青偃')).toBeInTheDocument();
    expect(screen.getByText('裴烈')).toBeInTheDocument();
    // 主角标识 + lead 卡片样式（第一行即主角）
    expect(container.querySelector('.who.lead')).not.toBeNull();
    expect(screen.getByText('主角')).toBeInTheDocument();
    // 契约字段（两人共用 fixture 数据，出现多次）
    expect(screen.getAllByText('辨魂、铭名').length).toBe(2);
    expect(screen.getAllByText('从求兄归到让兄安息').length).toBe(2);
  });

  it('数据损坏时降级为基础信息而不崩溃', () => {
    const rows = [makeCharacterRow('坏数据', 'protagonist', { data: '{oops' })];
    render(<CharacterView rows={rows} />);
    expect(screen.getByText('坏数据')).toBeInTheDocument();
    expect(screen.getByText(/仅展示基础信息/)).toBeInTheDocument();
  });
});
