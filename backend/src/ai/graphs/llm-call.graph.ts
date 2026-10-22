import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { AiConfig } from '../config/ai.config.js';
import { shouldRetry } from '../errors/error-classifier.js';

export interface LlmCallState {
  call: () => Promise<unknown>;
  result?: unknown;
}

const StateAnnotation = Annotation.Root({
  call: Annotation<() => Promise<unknown>>(),
  result: Annotation<unknown | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
});

/**
 * 把一次 LLM 调用包装成单节点图，从而使用 LangGraph 的节点级 RetryPolicy：
 * 限流与服务端错误退避重试，请求类错误与预算耗尽不重试。
 */
export function createLlmCallGraph(retry: AiConfig['retry']) {
  return new StateGraph(StateAnnotation)
    .addNode('llm-call', async (state: LlmCallState) => ({ result: await state.call() }), {
      retryPolicy: {
        maxAttempts: retry.maxAttempts,
        initialInterval: retry.initialInterval,
        backoffFactor: retry.backoffFactor,
        maxInterval: retry.maxInterval,
        jitter: retry.jitter,
        retryOn: shouldRetry,
        logWarning: false,
      },
    })
    .addEdge(START, 'llm-call')
    .addEdge('llm-call', END)
    .compile();
}
