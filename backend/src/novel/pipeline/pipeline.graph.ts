import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { PipelineMode, QuestionnaireAnswers, Stage } from '@rill/shared';

/**
 * 流水线图的 state。
 * 执行进度（当前阶段与中断位置）由 checkpointer 持久化；
 * 产物内容与失效标记仍存 Prisma，两者职责分离。
 */
export const PipelineStateAnnotation = Annotation.Root({
  projectId: Annotation<string>(),
  genre: Annotation<string>(),
  mode: Annotation<string>(),
  currentStage: Annotation<Stage>(),
  answers: Annotation<QuestionnaireAnswers>(),
});

export type PipelineState = typeof PipelineStateAnnotation.State;

/** 图中节点名：阶段节点 + 起止哨兵 */
export type PipelineNode = Stage | typeof START | typeof END;

/** 路由结果：某个阶段节点，或结束 */
export type StageRoute = Stage | typeof END;

/**
 * 阶段节点的执行体。图只负责编排与恢复，
 * 具体生成由注入的 runner 完成，使图拓扑可单独测试。
 */
export type StageRunner = (state: PipelineState, stage: Stage) => Promise<Partial<PipelineState>>;

export interface PipelineGraphOptions {
  /** 参与编排的阶段，顺序即流程顺序 */
  stages: Stage[];
  runner: StageRunner;
  /** 该类型声明跳过的阶段，作为跳过判定的二次保障（stages 通常已过滤） */
  skipStages?: Stage[];
}

/** 下一阶段：跳过被类型声明跳过的阶段；已是最后一个则结束 */
export function nextStage(current: Stage, stages: Stage[], skipStages: Stage[] = []): StageRoute {
  const index = stages.indexOf(current);
  if (index < 0) return END;
  for (let i = index + 1; i < stages.length; i += 1) {
    if (!skipStages.includes(stages[i])) return stages[i];
  }
  return END;
}

/**
 * 入口路由：按 state.currentStage 决定从哪个阶段开始执行。
 * 首次启动、失败续跑、显式重生成、回退后重跑统一为这一条路径。
 * currentStage 不在编排列表中时（如该类型跳过了该阶段）回退到首个阶段。
 */
export function routeEntry(state: PipelineState, stages: Stage[]): StageRoute {
  if (stages.includes(state.currentStage)) return state.currentStage;
  return stages[0] ?? END;
}

/** 构建流水线图：注册阶段节点，并接上入口路由与各阶段的推进边 */
export function buildPipelineGraph(options: PipelineGraphOptions) {
  const graph = new StateGraph<
    typeof PipelineStateAnnotation,
    PipelineState,
    Partial<PipelineState>,
    PipelineNode
  >(PipelineStateAnnotation);
  const skipStages = options.skipStages ?? [];

  for (const stage of options.stages) {
    const next = nextStage(stage, options.stages, skipStages);
    // currentStage 由 runner 维护（表示当前正在处理的阶段）；
    // 推进到下一节点由下面的条件边负责，中断点由 checkpointer 记录
    graph.addNode(stage, async (state: PipelineState) => options.runner(state, stage));
    graph.addConditionalEdges(stage, () => next);
  }

  graph.addConditionalEdges(START, (state: PipelineState) => routeEntry(state, options.stages));

  return graph;
}

export interface CompilePipelineOptions extends PipelineGraphOptions {
  checkpointer?: BaseCheckpointSaver;
  /** manual 模式在每个阶段后暂停等待确认；auto 模式不中断 */
  mode?: PipelineMode;
}

/**
 * 编译流水线图。manual 模式在阶段后中断，由 resume 推进；
 * 最后一个阶段完成后直接结束，不再暂停（否则恢复会重跑该阶段）。
 */
export function compilePipelineGraph(options: CompilePipelineOptions) {
  const graph = buildPipelineGraph(options);
  const skipStages = options.skipStages ?? [];
  const pausable = options.stages.filter(
    (stage) => nextStage(stage, options.stages, skipStages) !== END,
  );

  return graph.compile({
    ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
    ...(options.mode === 'manual' ? { interruptAfter: pausable } : {}),
  });
}
