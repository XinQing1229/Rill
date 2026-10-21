# Design

## Context

AI 基建（`ai-infrastructure`）已提供 `completeStructured`、重试与预算、用量埋点，可直接消费。但创作是多阶段流程且默认需要人在环路（每阶段确认后继续），阶段产物与推进状态必须跨请求持久化——内存 state 在进程重启或用户隔天确认时会丢失。类型每次选择、篇幅短篇起步并保留中长篇扩展，决定了流程不能写死。动机见 proposal.md - Why。

## Goals / Non-Goals

**Goals:**

- 项目与阶段状态持久化（SQLite + Prisma），服务重启可恢复
- 阶段流程由「类型 + 篇幅」配置决定，阶段可跳过
- 手动（默认）每阶段确认后推进；自动连续推进且失败可续跑
- 重新生成防护、回退导致下游失效
- 生成接口异步化（立即返回，状态机推进）
- 实现种子（Premise）阶段的生成，产物按 schema 校验后入库
- 每阶段记录 token 消耗
- 测试使用独立数据库，不污染开发数据

**Non-Goals:**

- 不实现世界观、人物、大纲、细纲、正文等阶段的**生成逻辑**（本次只建种子阶段；表结构随各阶段 change 逐步加入）
- 不做前端界面
- 不做多用户与鉴权
- 不引入任务队列（第一版由服务内异步执行即可，真正的队列留给正文生成场景）
- 不做产物历史版本管理（重新生成覆盖；需要回退历史时再加）

## Decisions

### 决策 1：Prisma + SQLite

- `backend/prisma/schema.prisma`，`DATABASE_URL="file:./dev.db"`，写入 `.env.example`；`*.db` 加入 `.gitignore`
- `PrismaService` 继承 `PrismaClient`，在 `onModuleInit` 连接、`onModuleDestroy` 断开
- **`prisma generate` 必须纳入构建流程**，否则 `dist` 缺少生成的客户端类型
- **理由**：本地零运维、schema 迁移方便、将来换 Postgres 成本低
- **备选**：TypeORM（装饰器风格与 Nest 更贴合，但迁移与类型体验弱于 Prisma）；JSON 文件（无法支撑状态机查询与后续规模）

**Prisma 7 实施差异（与原计划不同的地方）**：

- 新生成器 `prisma-client` **强制要求驱动适配器**（不再内置引擎），故使用 `@prisma/adapter-better-sqlite3` + `better-sqlite3`；该原生包的安装脚本需在本机 npm 11 下显式批准（`npm install-scripts approve better-sqlite3`）
- 数据源 URL 由 `prisma7.config.ts` 读取 `process.env.DATABASE_URL`，**不再**写在 schema 的 `env()` 中（Prisma 7 配置外置）
- SQLite **不支持 enum 与 Json 类型**：枚举以 `String` 存储，结构化产物以 JSON 字符串存储，读写时序列化/反序列化

### 决策 2：以 `Project` 为聚合根

- `Project`：id、title、genre、length、mode（manual/auto）、currentStage、status、token 统计
- 阶段产物各自成表，挂 `projectId`；本次只建 `Premise`（项目 1:1）
- **产物表通用字段**：`status`（pending/generating/done/failed）、`stale`（boolean）、`promptTokens`、`completionTokens`
- **世界观等类型差异大的产物将来用 JSON 列存**，但**生成期仍按类型的 zod schema 校验**——存储灵活与生成可靠兼得（本次不涉及世界观，作为后续阶段的既定原则）

### 决策 3：状态枚举与并发锁

- `pending → generating → done | failed`；`generating` 状态本身即并发锁（拒绝重复生成）
- 已 `done` 的阶段：未显式要求时不重复生成，直接返回已有产物
- `stale`：上游被修改后下游标记为失效，失效产物不得被下游生成直接使用，需先重新生成

### 决策 4：类型配置（genre profile）放在代码中，不入库

- 内容包括：类型枚举、世界观阶段是否跳过及详略权重、建议章节字数、注入 prompt 的类型特征变量
- **理由**：需要被 prompt 模板引用、变更频率低、放代码便于版本控制与单测
- 阶段列表由 `类型 + 篇幅` 共同计算

### 决策 5：模板按阶段设计，类型特征作为变量注入

- 避免「阶段 × 类型」的模板组合爆炸（6 阶段 × N 类型会失控）
- 模板 ID 按阶段组织，类型特征（题材要点、节奏要求、世界观权重）作为渲染变量注入

### 决策 6：生成异步化

- 生成接口立即返回（阶段进入 `generating`），由服务内异步任务推进状态
- **理由**：正文阶段可能耗时数十秒，同步阻塞会超时；状态字段现在就位，后续接队列或 SSE 无需改数据模型

### 决策 7：回退与失效

- 允许回退到任意已完成阶段；回退后其**之后**的所有阶段产物标记为 `stale`
- 重新生成某阶段时，同样将其下游标记为 `stale`

### 决策 8：自动模式失败续跑

- 自动模式按阶段列表推进；失败即停在该阶段并标记 `failed`
- 再次启动时从失败阶段继续，已完成阶段不重复生成（省 token）

### 决策 9：用量归因

- 阶段生成结束后，从 `UsageRecorder` 取该 traceId 的汇总用量，写入产物表的 `promptTokens` / `completionTokens`
- 与基建已有的 traceId 埋点打通，可按项目统计总成本

### 决策 10：测试隔离

- 测试使用独立 SQLite（`DATABASE_URL=file:./test.db`），每个套件执行前重置
- 避免测试污染开发数据，也避免并发冲突

### 决策 11：与 AI 基建的衔接

- 种子生成走 `LlmService.completeStructured`，schema 定义在 `@rill/shared`（前后端共享）
- 复用基建的重试、总预算与用量埋点，不重复实现

### 决策 12：问卷驱动的种子生成

- **必答 4 项**：类型、篇幅、基调、视角；其余维度为选答并提供默认值「不指定」
- **级联**：类型特有的选答项由 genre profile 声明（如玄幻问金手指与力量体系、悬疑问解谜风格），问卷由配置驱动而非写死
- **答案作为模板变量注入**，复用决策 5 的模板机制，不作为自然语言堆砌
- **用户已选维度不进 `PremiseSchema`**：直接落库，既避免模型输出与用户选择冲突，也减少生成负担
- **问卷结构版本化**：与提示词模板版本呼应，改动问卷后旧项目仍按其创建时的版本渲染与校验
- **契约放 `@rill/shared`**：选项枚举与问卷结构前后端共用——前端据此渲染表单，后端据此校验
- **理由**：选择题把用户意图从「自然语言推断」变为「确定输入」，显著提升一次命中率、减少重复生成成本；同时可枚举、可校验、可单测

## Risks / Trade-offs

- [SQLite 并发写锁] → 单用户本地工具场景无实质影响；将来多用户时再评估
- [`prisma generate` 遗漏会导致构建失败] → 纳入 `build` 脚本并在 CI 前本地验证
- [类型配置在代码中，变更需发版] → 可接受：变更频率低，且便于测试与评审
- [第一版异步无队列，进程重启会丢失进行中的任务] → 任务状态为 `generating` 时重启后应重置为 `failed` 以便重试；真正的队列留给正文生成
- [回退会连锁失效下游] → 明确规则：失效阶段必须重新生成，不复用过期产物
- [产物无历史版本] → 重新生成即覆盖；出现回退需求时再加版本表
- [图谱实体演进] → 第一版用具体的 `Character` / `Relation` 表（类型安全、Prisma 关系好用），扩展属性放 JSON 列；当实体类型增加到 3 类以上（如势力、地点）时，再抽通用实体表——本次不涉及，作为后续阶段的既定演进路径

## Migration Plan

不适用（新增能力）。回滚方式：revert 本次提交，并回退 Prisma 迁移。

## Open Questions

- 首个前端界面是否随下一个 change 一起做（当前后端先行，前端契约已由 `@rill/shared` 提供）。
- 正文的表存储 vs 文件存储：短篇起步先存表，预留 `filePath` 字段，待单本规模上来再评估。
