import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StagePanel } from './StagePanel';
import {
  makeCharacterRow,
  makePremiseRow,
  makeProject,
  makeRelationRow,
  makeWorldRow,
} from '../../test/fixtures';

const noop = () => {};

describe('StagePanel 状态分流', () => {
  it('上游未就绪时阻止生成并说明原因', () => {
    const project = makeProject(); // premise pending → world 阻塞
    render(
      <StagePanel
        project={project}
        stage="world"
        busy={false}
        onGenerate={noop}
        onConfirm={noop}
        onRollback={noop}
      />,
    );
    expect(screen.getByText('暂不能生成')).toBeInTheDocument();
    expect(screen.getByText(/尚未完成/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成世界观/ })).not.toBeInTheDocument();
  });

  it('待生成且上游齐备时显示生成按钮', () => {
    const project = makeProject({ premise: makePremiseRow({ status: 'done' }) });
    render(
      <StagePanel
        project={project}
        stage="world"
        busy={false}
        onGenerate={noop}
        onConfirm={noop}
        onRollback={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /生成世界观/ })).toBeInTheDocument();
  });

  it('生成中展示骨架与刷新提示', () => {
    const project = makeProject({
      status: 'running',
      premise: { ...makeProject().premise!, status: 'generating' },
    });
    render(
      <StagePanel
        project={project}
        stage="premise"
        busy={false}
        onGenerate={noop}
        onConfirm={noop}
        onRollback={noop}
      />,
    );
    expect(screen.getByText(/生成中，进度每 1.5 秒自动刷新/)).toBeInTheDocument();
  });

  it('失败展示错误与重试', () => {
    const project = makeProject({
      premise: makePremiseRow({ status: 'failed', error: '模型输出不符合结构' }),
    });
    render(
      <StagePanel
        project={project}
        stage="premise"
        busy={false}
        onGenerate={noop}
        onConfirm={noop}
        onRollback={noop}
      />,
    );
    expect(screen.getByText('生成失败')).toBeInTheDocument();
    expect(screen.getByText('模型输出不符合结构')).toBeInTheDocument();
  });

  it('失效展示警示', () => {
    const project = makeProject({
      premise: makePremiseRow({ status: 'done', stale: true }),
      currentStage: 'premise',
    });
    render(
      <StagePanel
        project={project}
        stage="premise"
        busy={false}
        onGenerate={noop}
        onConfirm={noop}
        onRollback={noop}
      />,
    );
    expect(screen.getByText('产物已失效')).toBeInTheDocument();
  });

  it('完成后渲染种子产物与阶段操作', () => {
    const project = makeProject({ premise: makePremiseRow({ status: 'done' }) });
    render(
      <StagePanel
        project={project}
        stage="premise"
        busy={false}
        onGenerate={noop}
        onConfirm={noop}
        onRollback={noop}
      />,
    );
    expect(
      screen.getByText('守碑人少女与碑中古战魂同行北上，修复断裂的边境碑阵。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认并推进' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
  });

  it('手动模式下确认按钮依赖模式', () => {
    const project = makeProject({ mode: 'auto', premise: makePremiseRow({ status: 'done' }) });
    render(
      <StagePanel
        project={project}
        stage="premise"
        busy={false}
        onGenerate={noop}
        onConfirm={noop}
        onRollback={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: '确认并推进' })).not.toBeInTheDocument();
  });

  it('未实现阶段显示预告', () => {
    const project = makeProject();
    render(
      <StagePanel
        project={project}
        stage="outline"
        busy={false}
        onGenerate={noop}
        onConfirm={noop}
        onRollback={noop}
      />,
    );
    expect(screen.getByText(/该阶段暂未开放/)).toBeInTheDocument();
  });

  it('人物阶段完成渲染人物卡与关系表', () => {
    const project = makeProject({
      currentStage: 'characters',
      premise: makePremiseRow({ status: 'done' }),
      world: makeWorldRow({ status: 'done' }),
      characters: [
        makeCharacterRow('沈青偃', 'protagonist'),
        makeCharacterRow('裴烈', 'supporting'),
      ],
      relations: [makeRelationRow('char_沈青偃', 'char_裴烈')],
    });
    render(
      <StagePanel
        project={project}
        stage="characters"
        busy={false}
        onGenerate={noop}
        onConfirm={noop}
        onRollback={noop}
      />,
    );
    expect(screen.getAllByText('沈青偃').length).toBe(2); // 人物卡 + 关系表
    expect(screen.getAllByText('裴烈').length).toBe(2);
    expect(screen.getByText('关系网')).toBeInTheDocument();
  });
});
