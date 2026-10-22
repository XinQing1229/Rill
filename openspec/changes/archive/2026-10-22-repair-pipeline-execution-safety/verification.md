# 验证报告：repair-pipeline-execution-safety

## 完整性

13/13 项任务完成；`openspec instructions apply` 返回 `all_done`。

## 正确性与证据

| 规范行为 | 实现 | 验证 |
| --- | --- | --- |
| 项目运行互斥，重复请求拒绝 | PipelineService.acquireRun 条件更新与 runId | 同时请求生成、运行期间回退和模式切换测试 |
| 产物、阶段状态和当前阶段进度拒绝旧任务写入 | commitGeneration 事务检查运行标识；StageRunner 使用相同提交边界 | 超时后迟到提交被拒绝测试；生成器及 runner 单测 |
| 超时取消与恢复 | AbortController 传入图与模型调用；checkpoint put/putWrites 验证运行标识；启动恢复中断状态 | 超时后重试、失败续跑、checkpointer 重启恢复测试 |
| 无产物首次失败与合法空集合成功 | StageRun 独立记录、详情 stageStates、前端优先读取阶段状态 | 首次失败和空集合确认测试、前端无产物错误展示测试 |
| 手动确认与回退语义 | 回退拒绝未完成目标，清理 checkpoint；无 checkpoint 确认定位下一阶段 | 回退后一次确认推进、未完成回退拒绝、重生成与下游 stale 测试 |
| 兼容既有数据 | 增量 SQLite 迁移、legacy 产物状态回退读取 | 内存 SQLite 应用旧迁移、写入旧数据、再执行新增迁移，验证内容保留 |
| 阶段能力集中 | StageStorage 提供行读取、状态更新和失效操作；ArtifactRegistry 聚合生成器依赖与存储操作、上游内容映射 | 既有全部生成器、上游装配与流水线测试 |

## 验证命令与结果

- 后端全量单测：18 组，147 项通过；新增回退约束后流水线 28 项通过（总计 148 项）。
- HTTP e2e：2 组，13 项通过。沙箱默认禁止监听本地端口，放行测试命令后通过。
- 前端：12 组，65 项通过。
- `npm run lint`、`npm run build`、OpenSpec strict validate、`git diff --check` 均通过。

## 设计一致性

沿用 SQLite、Prisma、LangGraph checkpoint 与现有生成器接口。运行所有权、事务提交隔离、取消传播、独立阶段记录与统一存储适配均已落实。无需外部队列或额外服务。

## 结论

无阻止本 change 交付的问题。现有前端测试的 act/getComputedStyle 提示及 Vite 包体积提示不影响本次验证结果。实现已完成，可以归档；本轮未自动归档。
