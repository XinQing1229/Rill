import { UpstreamAssembler } from './upstream.assembler';
import { ArtifactRegistry } from './artifact.registry';

describe('UpstreamAssembler.readStageState', () => {
  const assembler = new UpstreamAssembler({} as never, new ArtifactRegistry());

  it('1:1 产物直接返回状态与失效标记', () => {
    expect(
      assembler.readStageState({ premise: { status: 'done', stale: false } }, 'premise'),
    ).toEqual({
      status: 'done',
      stale: false,
    });
    expect(assembler.readStageState({ premise: null }, 'premise')).toBeUndefined();
  });

  it('stale 与 status 是独立维度：失效的完成产物仍报 done + stale', () => {
    const state = assembler.readStageState(
      {
        characters: [
          { status: 'done', stale: true },
          { status: 'done', stale: true },
        ],
      },
      'characters',
    );

    expect(state).toEqual({ status: 'done', stale: true });
  });

  it('存在失败行时报 failed', () => {
    const state = assembler.readStageState(
      {
        characters: [
          { status: 'done', stale: false },
          { status: 'failed', stale: false },
        ],
      },
      'characters',
    );

    expect(state).toEqual({ status: 'failed', stale: false });
  });

  it('混合未完成状态时报 generating', () => {
    const state = assembler.readStageState(
      {
        characters: [
          { status: 'done', stale: false },
          { status: 'pending', stale: false },
        ],
      },
      'characters',
    );

    expect(state).toEqual({ status: 'generating', stale: false });
  });

  it('无任何记录时报 undefined', () => {
    expect(assembler.readStageState({ characters: [] }, 'characters')).toBeUndefined();
    expect(assembler.readStageState({}, 'relations')).toBeUndefined();
  });

  it('未实现的阶段返回 undefined', () => {
    expect(
      assembler.readStageState({ premise: { status: 'done', stale: false } }, 'outline'),
    ).toBeUndefined();
  });
});
