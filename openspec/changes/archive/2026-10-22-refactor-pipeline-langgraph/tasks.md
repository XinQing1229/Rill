# Tasks

## 1. 技术验证与依赖

- [x] 1.1 验证持久化 checkpointer 选型：对比官方 `@langchain/langgraph-checkpoint-sqlite` 与基于现有 Prisma/SQLite 自实现 `BaseCheckpointSaver`，重点验证与现有 `@prisma/adapter-better-sqlite3` 的 SQLite 文件/锁能否共存（建议独立 checkpoint 库文件），并将结论回填 `design.md` 的 Open Questions
- [x] 1.2 按 1.1 结论新增 checkpointer 依赖（如官方包及其 `better-sqlite3` 适配），验证 `npm install` 成功且后端可正常启动

## 2. 图编排基建

- [x] 2.1 新增流水线图构建模块：定义 state（`projectId`、`genre`、`mode`、`currentStage`、`answers`）与阶段节点注册入口，验证 premise/world/characters/relations 四个已实现阶段可被注册为节点
- [x] 2.2 实现 START 之后的 router 条件边：按 `state.currentStage` 路由到对应阶段节点，验证首次启动、失败续跑、显式重生成、回退后重跑四种情况都路由到正确节点
- [x] 2.3 实现阶段节点之后的 advance 条件边：按类型 `skipStages` 判定跳过（`dushi`/`yanqing` 跳过 `world` 直接到 `characters`），验证跳过类型不生成世界观产物且下游依赖判定与 `ArtifactRegistry.requires` 一致
- [x] 2.4 接入持久化 checkpointer（`thread_id` = 项目 id），验证服务重启后能从中断处继续执行且不重复已完成阶段（对应 `pipeline-graph-orchestration` 的「执行进度持久化且可从中断处恢复」）
- [x] 2.5 实现 manual 模式的图内暂停：按 `mode` 准备两张图（manual 配 `interruptAfter`，auto 不配）并按项目当前 mode 选图，验证 manual 模式在阶段后暂停、暂停期间不发起后续阶段模型调用
- [x] 2.6 实现阶段节点内部流程：装配上游 → 调生成器 → 写 Prisma 产物 → 更新 state；节点入口做幂等检查（产物已 `done` 且未 `stale` 则跳到 advance 不重跑），验证重复恢复不重复调用模型
- [x] 2.7 为 outline/beats/prose 注册占位节点，验证触发这些阶段时返回「尚未实现」而非崩溃

## 3. 服务改造

- [x] 3.1 将 `PipelineService.generate` 改为启动/恢复图，验证接口仍能触发生成并返回阶段与状态
- [x] 3.2 将 confirm 改为 resume 语义并支持 `action`（`confirm` | `regenerate`），验证确认后从暂停处推进到下一阶段、regenerate 时重跑当前阶段
- [x] 3.3 将 rollback 改为更新 state 的 `currentStage` + 复用 `markDownstreamStale`，验证回退后下游产物失效且再次启动以目标阶段为起点
- [x] 3.4 删除 `runAuto` 的 `for` 循环与 `slice(startIndex)` 索引逻辑，改为 auto 图无中断一次执行，验证 auto 模式连续跑完全部阶段、失败停在该阶段且可从失败阶段续跑
- [x] 3.5 保留防并发运行锁与外层超时兜底（`Promise.race` 包住图执行），验证生成中拒绝重复触发、超时后阶段与项目被标记失败

## 4. 契约与前端

- [x] 4.1 调整 `shared/src/index.ts` 中确认相关契约（resume 请求/响应、thread 标识），验证 `npm run build` 通过且前后端类型一致
- [x] 4.2 将前端 `useProject` 与工作区页面改为 resume 驱动，验证确认按钮触发恢复并推进到下一阶段、进度展示不受影响

## 5. 测试平移

- [x] 5.1 按图语义重写 `backend/src/novel/pipeline/pipeline.service.spec.ts`，覆盖防并发、失败续跑、回退失效、跳过 world、幂等不重跑，验证 `npm run test -w @rill/backend` 单测通过
- [x] 5.2 按图语义重写 `backend/test/novel.e2e-spec.ts`，覆盖 manual 确认推进与 auto 连续推进两条主链路，验证 e2e 通过

## 6. 清理与全量验证

- [x] 6.1 移除 Prisma 中已下沉给 checkpointer 的执行态字段与过渡期冗余写入 —— **本次保留冗余写入，未清理**，原因：`Project.currentStage` / `Project.status` 作为执行进度的可读镜像，供 `get` / `list` 与前端时间轴直接查询；若移除，列表与详情需逐项目读 checkpointer 快照，复杂度与开销上升而收益不明。执行真相已由 checkpointer 承载（续跑、回退、重启恢复均以其为准），留待后续 change 在前端契约就绪后再清理
- [x] 6.2 全量验证：`npm test` 与 `npm run lint` 均通过，且 manual 与 auto 两种模式在本地端到端可跑通完整流程
