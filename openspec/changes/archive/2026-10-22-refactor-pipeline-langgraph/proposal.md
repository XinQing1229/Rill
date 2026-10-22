# Proposal

## Why

多阶段流水线的推进、回退、续跑当前由 `PipelineService` 手写状态机驱动：阶段顺序靠 `for` 循环推进，类型跳过靠 `stagesFor` 过滤后另算索引，人工确认靠前端轮询加 `confirm` 接口，执行状态散落在 Prisma 的 `currentStage`、`status` 与各产物行。目前只接入了 premise/world/characters/relations 四个阶段，后续 outline/beats/prose 接入时这些分支会继续膨胀；且「确认后推进」与生成流程本身脱节，没有统一的断点与恢复抽象。改用 LangGraph `StateGraph` 编排，让流程拓扑显式化：阶段为节点、类型跳过由条件边表达、人工确认由 `interrupt`/`resume` 表达、断点与恢复由 checkpointer 保证，后续阶段只需声明节点与依赖即可接入。

## What Changes

- 新增流水线 `StateGraph`：以 premise / world / characters / relations / outline / beats / prose 为节点，按阶段顺序连边；`world` 由条件边根据类型决定跳过（`dushi`、`yanqing` 等声明跳过世界观的类型直接路由到下一阶段）
- 引入 checkpointer 作为流水线**执行状态**的真相源（`thread_id` = 项目 id），承载「当前阶段、执行进展、中断点」，替代现有 Prisma 中的 `currentStage` 与执行态标记
- manual 模式在阶段产物生成完成后于图内 `interrupt` 暂停，经 resume 入口传入确认后继续推进；auto 模式不中断，连续跑完全部阶段
- `PipelineService` 从「手写编排」退化为「图入口与查询适配器」：`generate` / `confirm` / `rollback` 分别映射为启动图、恢复图、回退并改状态
- Prisma 保留为**业务产物**真相源（产物内容、`stale` 失效标记、token 用量、项目元数据与列表查询），不再承担流水线执行状态
- **BREAKING**：前端交互模型由「轮询 + `confirm` 接口推进」改为「resume 驱动」，确认请求需携带 thread 标识
- **BREAKING**：新增 checkpoint 持久化依赖与存储；当前仓库仅有内存版 checkpointer 可用，不满足「重启后仍可恢复」，必须一并引入持久化实现

## Capabilities

### New Capabilities

- `pipeline-graph-orchestration`: 以 LangGraph StateGraph 编排小说多阶段流水线——阶段节点与条件边、类型跳过路由、manual 模式的图内中断与恢复、checkpointer 承载的执行快照与续跑

### Modified Capabilities

- `novel-pipeline`: 「项目与阶段状态跨请求持久化」「手动模式下需确认后推进」「自动模式连续推进且失败可续跑」三条要求的实现机制改变——持久化载体由 Prisma 执行态字段改为 checkpointer，确认语义由接口轮询推进改为 interrupt/resume；需补充「执行快照本身必须持久化」以保证重启可恢复

## Impact

- 后端：`backend/src/novel/pipeline/pipeline.service.ts`（编排逻辑重写）、`backend/src/novel/pipeline/artifact.registry.ts`（阶段节点与依赖声明接入图）、`backend/src/ai/`（新增 checkpointer 与图构建，复用现有 `llm-call` 单节点重试图）、`backend/src/novel/novel.controller.ts`（确认入口改为 resume 语义）
- 契约：`shared/src/index.ts` 中 `GenerateResponse`、`ProjectDetail` 的阶段状态字段与确认相关请求/响应需调整
- 依赖：需新增 LangGraph checkpoint 持久化包（如 `@langchain/langgraph-checkpoint-sqlite` 及 `better-sqlite3` 相关适配）
- 存储：除现有 Prisma SQLite 外，新增 checkpoint 存储；需明确两者文件/库是否分离
- 测试：`backend/src/novel/pipeline/pipeline.service.spec.ts`、`backend/test/novel.e2e-spec.ts` 需按新的图驱动语义重写
- 前端：`frontend/src/hooks/useProject.ts`、`frontend/src/pages/ProjectWorkspacePage.tsx` 的确认与进度查询方式需随之调整
