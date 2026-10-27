import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorldView } from './WorldView';
import { worldData } from '../../test/fixtures';

describe('WorldView', () => {
  it('渲染通用骨架（概要/规则/势力）', () => {
    render(
      <WorldView
        world={worldData}
        genre="xuanhuan"
        premiseSetting={{ era: '大凛王朝末年', place: '北境青川关' }}
      />,
    );
    expect(screen.getByText(worldData.summary)).toBeInTheDocument();
    expect(screen.getByText('世界规则')).toBeInTheDocument();
    expect(screen.getByText(worldData.rules[0].name)).toBeInTheDocument();
    expect(screen.getByText('势力')).toBeInTheDocument();
    // 时代地点标注继承自种子
    expect(screen.getByText('继承自种子')).toBeInTheDocument();
    expect(screen.getByText(/大凛王朝末年 · 北境青川关/)).toBeInTheDocument();
  });

  it('玄幻渲染力量体系自定义块', () => {
    render(<WorldView world={worldData} genre="xuanhuan" />);
    expect(screen.getByText('力量体系')).toBeInTheDocument();
    expect(screen.getByText('铭魂境')).toBeInTheDocument();
    expect(screen.getByText(worldData.powerSystem.cost)).toBeInTheDocument();
  });

  it('组合类型同时展示全部世界观自定义块', () => {
    render(
      <WorldView
        genre={['xuanhuan', 'dushi']}
        world={{ ...worldData, industry: { field: '金融', rules: '交易制度' } }}
      />,
    );
    expect(screen.getByText('力量体系')).toBeInTheDocument();
    expect(screen.getByText('金融')).toBeInTheDocument();
    expect(screen.getByText('交易制度')).toBeInTheDocument();
  });

  it('没有自定义块的类型降级为提示', () => {
    const generic = {
      summary: worldData.summary,
      rules: worldData.rules,
      factions: worldData.factions,
    };
    render(<WorldView world={generic} genre="other" />);
    expect(screen.getByText('该类型没有自定义世界观块')).toBeInTheDocument();
  });

  it('详细档字段按数据有无渲染', () => {
    const detailed = {
      ...worldData,
      geography: [{ name: '青川关', description: '北境第一关' }],
    };
    render(<WorldView world={detailed} genre="xuanhuan" />);
    expect(screen.getByText('地理')).toBeInTheDocument();
    expect(screen.getByText('青川关')).toBeInTheDocument();
  });
});
