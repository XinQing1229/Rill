import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StageTimeline } from './StageTimeline';
import { makeCharacterRow, makePremiseRow, makeProject } from '../../test/fixtures';

describe('StageTimeline', () => {
  it('渲染含大纲的四个阶段与后续阶段预告', () => {
    const project = makeProject({
      premise: makePremiseRow(),
      characters: [makeCharacterRow('沈青偃', 'protagonist')],
    });
    render(<StageTimeline project={project} viewedStage={null} onSelect={() => {}} />);
    expect(screen.getByText('种子')).toBeInTheDocument();
    expect(screen.getByText('世界观')).toBeInTheDocument();
    expect(screen.getByText('人物')).toBeInTheDocument();
    expect(screen.getByText('大纲')).toBeInTheDocument();
    expect(screen.getByText('后续阶段')).toBeInTheDocument();
  });

  it('跳过世界观的类型不渲染该阶段', () => {
    const project = makeProject({
      genre: 'dushi',
      stages: ['premise', 'characters', 'relations', 'outline', 'beats', 'prose'],
      currentStage: 'characters',
    });
    render(<StageTimeline project={project} viewedStage={null} onSelect={() => {}} />);
    expect(screen.queryByText('世界观')).not.toBeInTheDocument();
    expect(screen.getByText('人物')).toBeInTheDocument();
  });

  it('各状态徽标如实渲染', () => {
    const project = makeProject({
      premise: makePremiseRow({ status: 'done' }),
      world: null,
    });
    render(<StageTimeline project={project} viewedStage={null} onSelect={() => {}} />);
    expect(screen.getByText('已完成')).toBeInTheDocument(); // premise
    expect(screen.getAllByText('待生成').length).toBe(3); // world、characters 与 outline
  });

  it('失效阶段显示已失效', () => {
    const project = makeProject({
      premise: makePremiseRow({ status: 'done', stale: true }),
      currentStage: 'world',
    });
    render(<StageTimeline project={project} viewedStage={null} onSelect={() => {}} />);
    expect(screen.getByText('已失效')).toBeInTheDocument();
  });

  it('点击已完成阶段回调', () => {
    const onSelect = vi.fn();
    const project = makeProject({ premise: makePremiseRow(), currentStage: 'world' });
    render(<StageTimeline project={project} viewedStage={null} onSelect={onSelect} />);
    (screen.getByText('种子').closest('.stage') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith('premise');
  });

  it('确认可用时渲染推进圆钮', () => {
    const project = makeProject({
      currentStage: 'characters',
      premise: makePremiseRow({ status: 'done' }),
      characters: [makeCharacterRow('沈青偃', 'protagonist')],
    });
    render(
      <StageTimeline
        project={project}
        viewedStage={null}
        onSelect={() => {}}
        advance={{ disabled: false, onClick: () => {} }}
      />,
    );
    expect(screen.getByLabelText('确认并推进下一阶段')).toBeInTheDocument();
  });
});
