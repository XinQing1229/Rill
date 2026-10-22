import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '@rill/shared';
import { useProject } from './useProject';
import { makeCharacterRow, makeProject } from '../test/fixtures';

vi.mock('../api/novel', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getProject: vi.fn(),
}));

import { getProject } from '../api/novel';

const mockGetProject = vi.mocked(getProject);

describe('useProject 轮询', () => {
  beforeEach(() => {
    mockGetProject.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('落定状态只请求一次', async () => {
    const project = makeProject();
    mockGetProject.mockResolvedValue(project);
    const { result } = renderHook(() => useProject('prj_1'));

    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(mockGetProject).toHaveBeenCalledTimes(1);
  });

  it('生成中轮询，落定即停', async () => {
    vi.useFakeTimers();
    const running: ProjectDetail = makeProject({
      status: 'running',
      premise: { ...makeProject().premise!, status: 'generating' },
    });
    const settled = makeProject({
      premise: { ...makeProject().premise!, status: 'done' },
    });
    let calls = 0;
    mockGetProject.mockImplementation(async () => {
      calls += 1;
      return calls <= 2 ? running : settled;
    });

    const { result, unmount } = renderHook(() => useProject('prj_1'));
    // 每个 fake-time 步骤包在 act 里，确保 setState 刷入
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(mockGetProject).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(mockGetProject).toHaveBeenCalledTimes(3);

    // 已落定：时间前进也不再请求，且展示的是落定后的详情
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mockGetProject).toHaveBeenCalledTimes(3);
    expect(result.current.project?.premise?.status).toBe('done');
    unmount();
  });

  it('1:N 阶段生成中继续轮询', async () => {
    vi.useFakeTimers();
    const running: ProjectDetail = makeProject({
      status: 'running',
      currentStage: 'characters',
      characters: [makeCharacterRow('甲', 'protagonist', { status: 'generating' })],
    });
    mockGetProject.mockResolvedValue(running);
    renderHook(() => useProject('prj_1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetProject).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockGetProject).toHaveBeenCalledTimes(2);
  });

  it('auto 阶段间隙（idle + 已完成）继续轮询', async () => {
    vi.useFakeTimers();
    const gap: ProjectDetail = makeProject({
      mode: 'auto',
      status: 'idle',
      currentStage: 'world',
      premise: { ...makeProject().premise!, status: 'done' },
    });
    mockGetProject.mockResolvedValue(gap);
    renderHook(() => useProject('prj_1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetProject).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockGetProject).toHaveBeenCalledTimes(2);
  });

  it('卸载后清理定时器', async () => {
    vi.useFakeTimers();
    const running: ProjectDetail = makeProject({
      status: 'running',
      premise: { ...makeProject().premise!, status: 'generating' },
    });
    mockGetProject.mockResolvedValue(running);
    const { unmount } = renderHook(() => useProject('prj_1'));
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockGetProject).toHaveBeenCalledTimes(1);
  });

  it('请求失败暴露错误信息', async () => {
    mockGetProject.mockRejectedValue(new Error('项目不存在'));
    const { result } = renderHook(() => useProject('prj_1'));
    await waitFor(() => expect(result.current.error).toBe('项目不存在'));
  });
});
