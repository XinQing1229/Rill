import { useCallback, useEffect, useState } from 'react';
import type { Genre, QuestionnaireDefinition } from '@rill/shared';
import { getQuestionnaire } from '../api/novel';

export interface QuestionnaireState {
  data: QuestionnaireDefinition | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** 按类型请求问卷结构；类型切换时清空旧结构并重新请求（级联） */
export function useQuestionnaire(genre: Genre | undefined): QuestionnaireState {
  const [data, setData] = useState<QuestionnaireDefinition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!genre) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setData(null);
    setLoading(true);
    setError(null);
    getQuestionnaire(genre)
      .then((definition) => {
        if (cancelled) return;
        setData(definition);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '问卷加载失败');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [genre, epoch]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  return { data, loading, error, reload };
}
