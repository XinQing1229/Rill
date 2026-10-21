# Proposal

## Why

脚手架阶段的 `LlmService` 只是一次裸的 LLM 调用封装：没有模型路由、没有提示词管理、没有结构化输出、失败无重试、成本与用量不可见。后续的小说能力（创意→大纲、章节生成、人物设定、润色）全部依赖这套能力，若不在领域功能之前把它抽出来，每个能力都会各自重复实现解析、重试与埋点，且长文生成的 token 成本与失败原因将完全不可控。

## What Changes

- 引入 LangChain / LangGraph 技术栈：`@langchain/core`、`@langchain/deepseek`、`@langchain/langgraph`、`zod`
- 新增模型注册表 `ModelRegistry`：按用途路由模型配置（`draft` / `reasoning`），模型名、temperature、maxTokens、timeout、thinking 开关均由配置驱动；**本次两个用途统一使用已实测可用的模型，不接入未验证的 `deepseek-v4-pro`**，用途差异体现在参数上
- 新增提示词模板管理：模板文件化、带版本号、变量渲染，缺失变量在发起调用前报错
- 新增结构化输出能力：基于 `withStructuredOutput(zodSchema)`，校验失败时把错误信息回喂模型重试，超过次数返回明确错误；结构化生成一律关闭思维链；验证所用的首个 schema 保持中性，不定义小说领域结构
- 新增可靠性策略：LangGraph `RetryPolicy` 节点级重试，区分 429 退避 / 5xx 重试 / 4xx 不重试，调用可超时中断，且单次生成的**总调用次数受预算上限约束**（避免修复重试与节点重试叠加导致成本失控）
- 思维链开关一律显式传参（`disabled` / `enabled`），不依赖模型默认行为（实测默认行为不确定）
- 新增可观测与成本记录：每次生成贯穿 traceId，记录模型、prompt/completion tokens、耗时与费用估算，**不记录 API key**
- 重写 `LlmService` 内部实现（由 `openai` SDK 换为 LangChain `ChatDeepSeek`），对外接口保持不变，`/api/llm/ping` 行为不受影响
- 结构化数据的 schema 放在 `@rill/shared`，供前后端共用

## Capabilities

### New Capabilities

- `ai-infrastructure`: 后端 AI 基建——模型路由、提示词模板管理、结构化输出与修复重试、失败重试与降级、可观测与成本记录

### Modified Capabilities

（无——`dev-environment` 的规范级行为不变：健康检查与连通性验证端点的契约保持一致）

## Impact

- 后端新增依赖：`@langchain/core`、`@langchain/deepseek`、`@langchain/langgraph`、`zod`
- 新增 `src/ai/` 目录：模型注册表、提示词模板、回调与埋点；`LlmService` 实现被重写（接口兼容）
- 后端配置新增模型用途映射与重试/超时参数
- `@rill/shared` 新增结构化输出的 schema 定义
- 日志新增生成调用的用量与耗时记录（不含密钥）
- 无前端改动，无 API 契约变更
