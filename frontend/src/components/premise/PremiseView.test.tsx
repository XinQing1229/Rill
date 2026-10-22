import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PremiseView } from './PremiseView';
import { premiseData } from '../../test/fixtures';

describe('PremiseView', () => {
  it('按契约结构完整展示字段', () => {
    render(<PremiseView premise={premiseData} />);
    expect(screen.getByText(premiseData.logline)).toBeInTheDocument();
    expect(screen.getByText(premiseData.theme)).toBeInTheDocument();
    expect(screen.getByText(premiseData.coreConflict)).toBeInTheDocument();
    expect(screen.getByText(premiseData.storyEngine!.openingGoal)).toBeInTheDocument();
    expect(screen.getByText(premiseData.storyEngine!.mainObstacle)).toBeInTheDocument();
    expect(screen.getByText(premiseData.storyEngine!.failureCost)).toBeInTheDocument();
    for (const step of premiseData.storyEngine!.escalationPath) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    expect(screen.getByText(/大凛王朝末年 · 北境青川关/)).toBeInTheDocument();
    expect(screen.getByText(premiseData.hook)).toBeInTheDocument();
    expect(screen.getByText('沈青偃')).toBeInTheDocument();
    // 避雷标签
    for (const taboo of premiseData.taboos) {
      expect(screen.getByText(taboo)).toBeInTheDocument();
    }
  });

  it('缺失的可选字段不留空白区域（本 schema 无可选字段，稳态渲染）', () => {
    render(<PremiseView premise={premiseData} />);
    expect(screen.getAllByText(/守碑人/).length).toBeGreaterThan(0);
  });

  it('兼容没有故事发动机的历史种子', () => {
    const legacy = { ...premiseData };
    Reflect.deleteProperty(legacy, 'storyEngine');
    render(<PremiseView premise={legacy} />);
    expect(screen.getByText(legacy.logline)).toBeInTheDocument();
    expect(screen.queryByText('故事发动机')).not.toBeInTheDocument();
  });
});
