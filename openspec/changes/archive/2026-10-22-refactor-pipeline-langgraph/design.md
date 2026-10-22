# Design

## Context

动机见 `proposal.md`。当前实现（重构前的基线）：

- `PipelineService` 手写编排：`generate` 靠 `Project.status='running'` 行锁防并发，`confirm` 手动推进 `currentStage+1`，`rollback` 回退并调 `markDownstreamStale` 标记下游失效，`runAuto` 用 `for` 循环连续推进、失败停在当前阶段
- 状态分散在 Prisma：`Project.currentStage` / `Project.status`（idle|running|failed|done）+ 各产物行的 `status`（pending|generating|done|failed）与 `stale` 标记
- 阶段列表动态：`stagesFor(genre)` 按 `GENRE_PROFILES[genre].skipStages` 过滤（`dushi`/`yanqing` 跳过 `world`），`ArtifactRegistry` 用 `requires(answers)` 动态声明上游依赖
- 已有 LangGraph 使用仅限 `backend/src/ai/graphs/llm-call.graph.ts`：单节点包住一次 LLM 调用，只为借用节点级 `RetryPolicy`
- 依赖现状：`@langchain/langgraph@^1.5.1` 已装，**checkpoint 持久化包未安装**（仅内存版可用）；Prisma 走 `@prisma/adapter-better-sqlite3`
- 已实现阶段：premise / world / characters / relations；outline / beats / prose 仍是 TODO

## Goals / Non-Goals

**Goals:**

- 用一张 `StateGraph` 表达流水线拓扑：阶段为节点，跳过由条件边表达
- checkpointer 承载「流程走到哪、中断在哪、能否恢复」
- manual 模式用 `interrupt`，确认经 resume 推进；auto 模式不中断跑完
- 后续 outline/beats/prose 只需新增节点 + 依赖声明即可接入
- 保持 `novel-pipeline` spec 的可观察行为：跨重启可恢复、失败可续跑、防并发、回退下游失效

**Non-Goals:**

- 不改动各阶段生成器内部（提示词、schema、结构化输出、用量记录保持现状）
- 不改动 `llm-call` 单节点重试图的语义（它继续只负责单次 LLM 调用重试）
- 不引入多智能体、并行分支、人工编辑产物回写等超出「编排」的新能力
- 不重写前端视觉与组件结构，仅调整确认与进度的调用方式

## Decisions

### 决策 1：状态真相分层——checkpointer 管执行，Prisma 管产物（**Prisma 不可去掉**）

结论：**不能完全去掉 Prisma**。两者存的东西不同，职责如下：

```text
   ┌──────────────────────────────────────────┐
   │  checkpointer  (执行真相)                 │
   │  thread_id = projectId                   │
   │  - 当前阶段 / 执行进展                    │
   │  - interrupt 断点                         │
   │  - 可 resume 的 state 快照                │
   │  → 替代：Project.currentStage、           │
   │          Project.status 的执行语义        │
   │          （running / 待确认 / 失败可续跑） │
   └──────────────────────────────────────────┘
   ┌──────────────────────────────────────────┐
   │  Prisma  (业务产物真相 — 保留)             │
   │  - 产物内容 data（种子/世界观/人物/关系）   │
   │  - stale 失效标记                         │
   │  - promptTokens / completionTokens       │
   │  - 项目元数据：title/genre/length/        │
   │    mode/answers                          │
   │  - 列表查询：ProjectList 按 updatedAt    │
   │    倒序、characters(id)、relations(id)   │
   └──────────────────────────────────────────┘
```

**为什么 Prisma 去不掉：**

1. checkpointer 存的是图的执行快照（LangChain 内部序列化格式），不是业务模型——无法支撑「按项目取人物列表」「按项目取关系列表」「按更新时间倒序列项目」这类结构化查询
2. 产物是长期业务资产，必须跨执行留存并供前端反复渲染（人物卡、关系网、世界观），而 checkpoint 快照的生命周期是「一次执行」
3. token 用量需要按项目聚合统计，checkpoint blob 做不了

**可以下沉给 checkpointer 的**：`currentStage`、`Project.status` 的执行语义（是否运行中、是否卡在中断点、是否失败可续跑）。

**必须留在 Prisma 的**：产物内容、`stale`、用量、项目元数据与所有列表查询。

> 注：`stale` 保留在 Prisma 是刻意的——它是跨请求、跨图实例的业务语义（上游重生成导致下游失效），回退时要批量标记下游，放在执行快照里反而要额外同步。

### 决策 2：checkpointer 必须选持久化实现（内存版不达标）

`novel-pipeline` spec 明确要求「服务重启后查询此前创建的项目，仍能取到当前阶段并继续」。`MemorySaver` 重启即丢，会直接违反该要求。因此**持久化 checkpointer 是本 change 的硬依赖**，不能先用内存版占位。

候选（需技术验证，见 Open Questions）：

- `@langchain/langgraph-checkpoint-sqlite`：官方实现，基于 `better-sqlite3`；项目已有 `better-sqlite3` 生态（Prisma 用其适配），需确认与 Prisma 数据库文件能否共存（建议独立 checkpoint 库文件，避免共享文件带来锁竞争）
- 自定义 `BaseCheckpointSaver` 基于现有 Prisma/SQLite：不新增依赖、与业务同库同事务，但要自己实现序列化与迁移

### 决策 3：图拓扑——START 后 router 条件边 + 阶段节点后 advance 条件边

```text
                        ┌─────────────────────────┐
                        │  state (checkpointer)   │
                        │  projectId, genre, mode │
                        │  currentStage, answers  │
                        └───────────┬─────────────┘
                                    │
   START ──> [router] ──按 state.currentStage 路由──>  ┌──────────┐
                 │                                     │ premise  │
                 │                                     └────┬─────┘
                 ├──> world ──────┐                         │
                 ├──> characters  │                    [advance]
                 ├──> relations   │                 条件边（三选一）
                 ├──> outline     │                         │
                 ├──> beats       │        ┌────────────────┼────────────────┐
                 └──> prose       │        │                │                │
                                  │   manual 模式       auto 模式      末阶段后
                                  │   → interrupt       → 下一节点      → END
                                  │   （等 resume）
                                  │
                  premise 后 [advance] 按 genre.skipStages
                  判定：跳过 world 则直接路由到 characters
```

要点：

- **单一 router 入口**让「首次启动 / 失败续跑 / force 重生成 / 回退后重跑」统一为同一种操作——只需设置 `state.currentStage`，再从 START 恢复执行。这是本次重构相对手写循环最大的收益：现有 `runAuto` 的 `slice(startIndex)`、`rollback` 的索引计算都被 router 取代
- **跳过 world** 由 premise 之后的 advance 条件边按 `skipStages` 判定（`dushi`/`yanqing` 直接到 characters），与 `artifact.registry` 的 `requires(answers)` 动态依赖声明共用同一份事实来源
- **阶段节点内部**：装配上游 → 调生成器 → 写 Prisma 产物 → 更新 state。生成器与 `LlmService`（含 `llm-call` 单节点重试图）保持现状，不做图嵌套

### 决策 4：manual 模式用 interrupt / resume，按 mode 决定图的中断配置

- 按 `mode` 准备两张图（可缓存）：manual 图在阶段节点上配 `interruptAfter`，auto 图不配
- 确认 = 以 `thread_id=projectId` 恢复执行（`invoke` 传 null 继续）；auto 模式一次 invoke 跑到 END
- 「确认继续」与「重新生成」需区分入口：resume 请求携带 `action`（`confirm` | `regenerate`），`regenerate` 走 `updateState` 把该阶段标为待重跑后再恢复
- 前端交互从「轮询 + `confirm` 接口」改为「resume 驱动」，需传 thread 标识

### 决策 5：回退采用「重置 currentStage + 标下游 stale」，不用 time travel

LangGraph 支持从历史 checkpoint 分叉（time travel），但当前 `rollback` 语义是「回到目标阶段，下游标失效，停在目标阶段等重新生成」——用 `updateState` 改 `currentStage` + 复用现有 `markDownstreamStale` 即可，简单且行为等价。time travel 留作后续可选增强。

### 决策 6：防并发与超时保留在图层之外

- 防并发：checkpointer 不提供项目级互斥。保留一个轻量运行锁（继续写 Prisma 的执行态标记，或内存级 thread 锁）用于拒绝重复触发；语义对齐现有「生成中拒绝新请求」
- 超时：继续用现有 `Promise.race` 在**外层**包住 `graph.invoke`，超时后标记阶段与项目失败。图驻留不等于把超时交给框架

## Risks / Trade-offs

- **[双写不一致]** 阶段节点先写 Prisma 产物、再让 checkpoint 落盘，两者不在同一事务，崩溃可能出现「产物已写但断点未存」→ **缓解**：节点入口做幂等检查——resume 时若该阶段产物已 `done` 且未 `stale`，直接跳到 advance，不重复调用模型（这也顺带满足「已完成阶段不重复生成」）
- **[checkpointer 持久化选型未定]** 官方 sqlite 包与 Prisma 可能争抢同一 SQLite 文件的锁；自实现 saver 则增加维护面 → **缓解**：先做技术验证（spike），见 Open Questions；倾向独立 checkpoint 库文件
- **[行为回归风险]** 防并发、失败续跑、回退失效是 spec 明确要求，重构期间易丢失 → **缓解**：现有 `pipeline.service.spec.ts` 与 `novel.e2e-spec.ts` 的场景按新语义平移，作为回归基线；过渡期保留 Prisma 执行态字段冗余写入以便降级与比对
- **[interrupt 与 mode 运行时切换]** `setMode` 后若图已按旧 mode 中断，resume 用哪张图需明确 → **缓解**：每次 invoke 按项目当前 `mode` 选图，不缓存到具体项目实例
- **[前端改造面]** 确认入口语义变化会波及 `useProject` 与工作区页面 → **缓解**：本 change 一并调整，不保留双套交互

## Migration Plan

1. **技术验证**：确认持久化 checkpointer 选型（官方 sqlite 包 vs 自实现），验证与现有 Prisma SQLite 共存性
2. **基建**：新增依赖与 checkpointer 装配；新增图构建模块（节点 / 条件边 / interrupt 配置）
3. **图骨架**：接入 premise / world / characters / relations 四个已实现节点；outline / beats / prose 占位（触发时抛「尚未实现」，与现状一致）
4. **服务改造**：`PipelineService` 的 `generate` / `confirm` / `rollback` / `runAuto` 改为对图的操作；过渡期继续冗余写 Prisma 执行态字段
5. **契约与前端**：调整 `shared` 中确认相关契约，`useProject` 与工作区页面改为 resume 驱动
6. **测试平移**：单测与 e2e 按新语义重写，覆盖防并发、续跑、回退失效、跳过 world
7. **清理**：确认稳定后移除 Prisma 中已下沉的执行态字段与冗余写入

**回滚策略**：过渡期（步骤 4–5）Prisma 执行态字段仍在写，可据此降级回退；图稳定并清理字段后，回滚依赖 git 版本回退。

## Open Questions

- **checkpointer 具体选型** —— **已决议**（任务 1.1 验证完成，结论如下）：采用官方 `@langchain/langgraph-checkpoint-sqlite@1.1.0`，使用**独立于 Prisma 的 checkpoint 库文件**
  - 该包为 ESM-only（`"type": "module"`），后端为 CommonJS；Node v24.21.0 的 `require(esm)` 可正常加载，无需改造后端模块格式
  - 其依赖 `better-sqlite3@^12.10.0`，项目中已有 `12.11.1`（由 `@prisma/adapter-better-sqlite3` 带入且已编译），安装只新增 1 个包，**未触发原生模块重编译**
  - 持久化与重启恢复验证通过：丢弃实例后用新实例打开同一 checkpoint 文件，仍能读回中断处状态
  - 共存验证通过：checkpoint 库与另一 `better-sqlite3` 连接（模拟 Prisma 的 `dev.db`）指向不同文件时可同时读写，无锁竞争
- **Prisma 执行态字段的保留时长**：过渡期保留多久、是否在本次 change 内清理（步骤 7），可按实施节奏决定
