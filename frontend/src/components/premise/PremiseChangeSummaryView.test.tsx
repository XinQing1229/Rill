import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { PremiseChangeSummary, PremiseChangePath } from '@rill/shared';
import { PremiseChangeSummaryView } from './PremiseChangeSummaryView';

it('默认展示中文字段与说明，展开可查看真实前后原文', () => {
  render(
    <PremiseChangeSummaryView
      summary={{
        version: 1,
        changes: [
          {
            path: 'coreConflict',
            before: '原冲突',
            after: '新冲突',
            description: '加入需要合作的矛盾',
            descriptionSource: 'ai',
          },
        ],
      }}
    />,
  );
  expect(screen.getByRole('heading', { name: '本次修改 · 1 项' })).toBeInTheDocument();
  expect(screen.getByText('加入需要合作的矛盾')).toBeVisible();
  expect(screen.getByText('原冲突')).not.toBeVisible();
  fireEvent.click(screen.getByText('查看「核心冲突」修改前后'));
  expect(screen.getByText('原冲突')).toBeVisible();
  expect(screen.getByText('新冲突')).toBeVisible();
  expect(screen.getByText('修改前')).toBeVisible();
  expect(screen.queryByText('coreConflict')).not.toBeInTheDocument();
});

it('超过五项可展开剩余项，总数保持完整', () => {
  const paths: PremiseChangePath[] = [
    'title',
    'logline',
    'theme',
    'coreConflict',
    'hook',
    'protagonist.name',
  ];
  const summary: PremiseChangeSummary = {
    version: 1,
    changes: paths.map((path) => ({
      path,
      before: '原文',
      after: '新文',
      description: `说明 ${path}`,
      descriptionSource: 'fallback',
    })),
  };
  render(<PremiseChangeSummaryView summary={summary} />);
  expect(screen.getByRole('heading', { name: '本次修改 · 6 项' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: '主角 / 姓名' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '展开其余 1 项' }));
  expect(screen.getByRole('heading', { name: '主角 / 姓名' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '收起其余修改项' }));
  expect(screen.queryByRole('heading', { name: '主角 / 姓名' })).not.toBeInTheDocument();
});

it('区分原值缺失和数组值，保持列表原顺序', () => {
  render(
    <PremiseChangeSummaryView
      summary={{
        version: 1,
        changes: [
          {
            path: 'storyEngine.escalationPath',
            before: null,
            after: ['证人失踪', '证据销毁'],
            description: '补充压力升级',
            descriptionSource: 'ai',
          },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByText('查看「故事发动机 / 压力升级」修改前后'));
  expect(screen.getByText('原种子未提供')).toBeVisible();
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    '证人失踪',
    '证据销毁',
  ]);
});

it('历史、损坏摘要与零变化均有明确提示', () => {
  const view = render(<PremiseChangeSummaryView summary={null} />);
  expect(screen.getByText(/生成于修改摘要功能上线前/)).toBeVisible();
  view.rerender(<PremiseChangeSummaryView summary={null} warning="摘要暂不可用" />);
  expect(screen.getByText('摘要暂不可用')).toBeVisible();
  view.rerender(<PremiseChangeSummaryView summary={{ version: 1, changes: [] }} />);
  expect(screen.getByText('本次未检测到字段变化，可调整建议后重试。')).toBeVisible();
});
