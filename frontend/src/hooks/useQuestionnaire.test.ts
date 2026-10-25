import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Genre } from '@rill/shared';
import { useQuestionnaire } from './useQuestionnaire';
import { questionnaireFixture } from '../test/fixtures';

vi.mock('../api/novel', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQuestionnaire: vi.fn(),
}));

import { getQuestionnaire } from '../api/novel';

const mockGetQuestionnaire = vi.mocked(getQuestionnaire);

describe('useQuestionnaire 级联', () => {
  beforeEach(() => {
    mockGetQuestionnaire.mockReset();
  });

  it('按类型请求问卷结构', async () => {
    mockGetQuestionnaire.mockResolvedValue(questionnaireFixture);
    const { result } = renderHook(() => useQuestionnaire('xuanhuan' as Genre));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data?.version).toBe('v2'));
    expect(mockGetQuestionnaire).toHaveBeenCalledWith('xuanhuan');
  });

  it('切换类型时清空旧结构并重新请求', async () => {
    mockGetQuestionnaire.mockResolvedValue(questionnaireFixture);
    const { result, rerender } = renderHook(({ genre }) => useQuestionnaire(genre), {
      initialProps: { genre: 'xuanhuan' as Genre | undefined },
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    mockGetQuestionnaire.mockClear();
    rerender({ genre: 'dushi' as Genre });

    // 旧数据立即清空，随后拿到新类型的问卷
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(mockGetQuestionnaire).toHaveBeenCalledWith('dushi');
    expect(mockGetQuestionnaire).toHaveBeenCalledTimes(1);
  });

  it('未选类型时不请求', async () => {
    renderHook(() => useQuestionnaire(undefined));
    expect(mockGetQuestionnaire).not.toHaveBeenCalled();
  });

  it('请求失败暴露错误', async () => {
    mockGetQuestionnaire.mockRejectedValue(new Error('后端不可用'));
    const { result } = renderHook(() => useQuestionnaire('xuanhuan' as Genre));
    await waitFor(() => expect(result.current.error).toBe('后端不可用'));
  });
});
