# Design

## Context

脚手架阶段的 `LlmService` 基于 `openai` SDK，仅提供 `complete()` 与预留的 `stream()`，无模型路由、无提示词管理、无结构化输出、无重试与埋点。DeepSeek 与 OpenAI 协议兼容已通过真实调用验证，可用模型为 `deepseek-flash`。动机见 proposal.md - Why。

关键实测结论（本次变更前补做）：

| 调用方式 | 实测结果 |
| --- | --- |
| `thinking: {"type":"disabled"}` | 200，无 `reasoning_content`，无推理 token |
| `thinking: {"type":"enabled"}` | 200，有 `reasoning_content`，27/29 个 completion token 用于推理 |
| 不传 `thinking` 参数 | **行为不确定**——同一模型出现过一次推理、一次不推理 |

## Goals / Non-Goals

**Goals:**

- 模型按用途路由，参数全部配置驱动
- 提示词模板化、版本化、可单测
- 结构化输出带校验与修复重试
- 失败按错误类型重试、可超时中断、总调用次数受预算约束
- 每次生成可追踪（traceId）+ 汇总用量/耗时/费用可见，且密钥不落日志
- `LlmService` 对外接口保持兼容，`/api/llm/ping` 行为不变

**Non-Goals:**

- **不接入 `deepseek-v4-pro`**（未实测，本次所有用途统一使用已验证的模型）
- 不启用 LangGraph checkpoint 持久化（需存储，且当前排除了数据库）
- 不接入 LangSmith（云端依赖，稳定性未验证）
- 不做 SSE 流式端到端（留给章节生成场景）
- 不实现任何小说领域能力（大纲、章节、人物等）
- 不改前端，不改 API 契约

## Decisions

### 决策 1：采用 LangChain + LangGraph 技术栈

- **依赖**：`@langchain/core`、`@langchain/deepseek`、`@langchain/langgraph`、`zod`
- **理由**：LangGraph 提供节点级 `RetryPolicy`，为后续多步编排（创意→大纲→章节）预留演进路径；`@langchain/deepseek` 是官方包，`withStructuredOutput(zod)` 提供结构化输出；LangChain callback 机制可直接承载埋点。
- **代价**：依赖体积与抽象层增加；本次实际只用到 `RetryPolicy` 与结构化输出，编排价值要到 L4 才体现。缓解：锁定版本，并把 LangChain 完全封装在 `src/ai/` 内部，领域层不直接依赖，将来替换成本可控。
- **备选**：Vercel AI SDK（结构化输出体验好，但缺少编排演进路径）；`openai` SDK 自研薄层（依赖最少，但重试/结构化/埋点全部自写）。

### 决策 2：模型注册表 `ModelRegistry`，本次统一使用已验证模型

- 用途到配置的映射：`draft`（temperature 偏高、关闭思维链）；`reasoning`（temperature 偏低、开启思维链）
- **本次两个用途均指向 `deepseek-flash`**，差异只在参数；`deepseek-v4-pro` 暂不启用（未实测）
- 将来接入新模型只需改配置，不改代码
- 每项配置含：model、temperature、maxTokens、timeout、thinking

### 决策 3：思维链必须显式指定，绝不依赖默认值

- 每次调用都显式传 `thinking: {type: "disabled" | "enabled"}`
- **依据**：实测中「不传参数」时模型行为不确定（一次推理、一次不推理）
- 成本依据：开启推理时约 93% 的 completion token 用于推理，草稿场景必须关闭

### 决策 4：`LlmService` 接口兼容，内部换实现

- 保留 `complete()` 与预留 `stream()`，新增 `completeStructured(schema, messages)`
- 内部由 `openai` SDK 换为 `ChatDeepSeek`
- `/api/llm/ping` 改走 `draft` 用途并接入埋点，使该端点同时验证基建链路本身

### 决策 5：自研轻量提示词模板，不用 `ChatPromptTemplate`

- 模板以文件形式存放，命名 + 版本号，变量用简单占位符渲染，渲染前校验必填变量
- **理由**：版本化与单测更直接，避免 LangChain 模板 API 变动带来的连带影响
- **关键约束**：模板按「稳定前缀在前、可变内容在后」组织，以命中 DeepSeek 的上下文缓存降低成本

### 决策 6：结构化输出 = `withStructuredOutput` + 修复重试

- schema 用 zod 定义，放置在 `@rill/shared`，前后端共享同一份契约
- **结构化生成一律关闭思维链**（避免推理占用输出预算、且与 JSON 输出可能冲突）
- 校验失败时把错误信息回喂模型重试，次数由配置控制（建议 ≤2）；耗尽后抛明确错误（不含密钥）
- 验证结构化输出所用的首个 schema 保持中性（如「书名 + 一句话简介 + 标签」），**不定义小说领域结构**——领域建模留给后续「大纲生成」change

### 决策 7：重试分层 + 总调用预算

- **内层**：结构化输出的校验修复重试（建议 ≤2 次），只处理「格式不合规」
- **外层**：LangGraph `RetryPolicy` 节点重试（`initialInterval` / `backoffFactor` / `maxInterval` / `maxAttempts` 均可配置），只处理网络/限流/服务端错误
- **总预算**：单次生成请求累计模型调用次数上限（配置），达到即停止重试并返回错误——避免两层重试叠加导致调用次数与成本失控
- 错误分类：429 退避重试；5xx 重试；4xx（参数/认证）不重试
- 超时：模型调用带 timeout，超时中断并计入失败与预算

### 决策 8：可观测与成本 = 自研 callback handler

- NestJS 侧为每个请求生成 traceId，透传进 LangChain callback
- 在 callback 中记录：模型名、prompt/completion tokens、耗时、费用估算（按配置单价计算）
- **用量按 traceId 聚合**：重试产生的多次调用汇总为一条记录，避免统计重复计数
- **安全**：日志绝不记录 API key；完整 prompt 原文由开关控制，默认不记录
- 不接 LangSmith，避免云端依赖与额外密钥管理

### 决策 9：配置结构用 zod 校验

配置项（用途映射、temperature、maxTokens、timeout、thinking、重试三层参数、费用单价）较多，用 zod 定义配置结构并在启动时校验，缺失或非法即刻报错退出，避免运行到调用时才炸。

### 决策 10：不启用 checkpoint

LangGraph 的 checkpoint 需要存储后端（内存 / SQLite / Postgres），而持久化仍在范围外；本次仅单次调用，无需断点续跑。等到多步编排（L4）时再连同存储方案一起决策。

## Risks / Trade-offs

- [LangChain/LangGraph API 迭代快] → 锁定版本；LangChain 仅出现在 `src/ai/` 内部，对外接口隔离变动
- [错误状态码提取不确定] → LangChain 封装后的错误对象未必直接暴露 HTTP status；先做一次小验证（故意触发 401/400）确认可拿到状态码，再实现分类逻辑
- [思维链行为不确定] → 已由决策 3 消除：显式传参
- [开启推理成本高] → 草稿与结构化场景强制关闭；重推理用途按需使用并记录用量
- [依赖体积增大 + 安装慢] → 后端服务无前端包体压力；注意本机官方源仅 14 KB/s，安装时使用镜像源
- [费用估算需单价] → 单价写进配置，允许为空（为空时只记录 token 不估算费用）
- [本次只用 flash，未来接入新模型需验证] → 配置化设计已预留，接入前补一次真实调用验证

## Migration Plan

不适用（新增能力，不改动既有契约）。回滚方式：revert 本次 change 的提交，`LlmService` 回到 `openai` SDK 实现。

## Open Questions

- DeepSeek 上下文窗口大小未实测——长篇上下文管理策略留到章节生成场景再定。
- 费用阈值与告警策略暂不设定，先保证用量可见。
- 未来是否接入第二个模型/提供商：接入后再启用「模型降级」策略（本次单一模型无降级目标）。
