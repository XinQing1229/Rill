# Tasks

## 1. 技术栈接入与配置

- [x] 1.1 安装 `@langchain/core`、`@langchain/deepseek`、`@langchain/langgraph`、`zod` 到后端工作区（注意本机官方源较慢，使用镜像源安装） — verify: `npm ls` 能看到四个包且版本已锁定
- [x] 1.2 扩展后端配置：用途映射（draft/reasoning，默认均指向已验证模型）、temperature、maxTokens、timeout、thinking、重试分层参数、总调用预算、费用单价 — verify: 单测验证两种用途的参数差异且模型名均来自配置
- [x] 1.3 用 zod 定义配置结构并在启动时校验，缺失或非法即刻报错退出 — verify: 单测或手动置空必填项，服务启动失败并给出明确提示
- [x] 1.4 更新 `.env.example`，补充新增的 AI 配置项（含说明与默认值） — verify: 按模板复制后可正常启动

## 2. 模型注册表与 LlmService 重构

- [x] 2.1 实现 `ModelRegistry`：按用途返回 `ChatDeepSeek` 实例与参数，且**总是显式传 thinking 的 disabled/enabled** — verify: 单测验证两种用途的 thinking 参数均被显式设置，无 undefined 情况
- [x] 2.2 重写 `LlmService`：保留 `complete()` 与预留 `stream()`，新增 `completeStructured()`，内部改用 LangChain — verify: `POST /api/llm/ping` 仍返回真实结果，行为与重构前一致
- [x] 2.3 将 `/api/llm/ping` 改为走 `draft` 用途并接入埋点 — verify: 调用后日志出现该次调用的 traceId 与用量
- [x] 2.4 将 LangChain 依赖限制在 `src/ai/` 内部，领域层不直接引用 — verify: 在 `src` 中搜索，LangChain 导入仅出现在 `src/ai/`

## 3. 提示词模板管理

- [x] 3.1 实现模板加载与渲染（命名 + 版本号 + 变量校验） — verify: 单测覆盖正常渲染、版本差异、变量缺失报错
- [x] 3.2 内置首个模板并按「稳定前缀在前」组织 — verify: 单测验证渲染结果前缀稳定

## 4. 结构化输出与修复重试

- [x] 4.1 在 `@rill/shared` 定义中性的验证用 schema（书名 + 一句话简介 + 标签，不含小说领域结构） — verify: 前后端均可 import 且 `tsc` 无错误
- [x] 4.2 实现 `completeStructured()`：`withStructuredOutput` + 校验失败回喂重试，且**关闭思维链** — verify: 单测 mock 首次不合规、第二次合规的场景，断言重试发生、返回合规对象且调用未开启 thinking
- [x] 4.3 修复重试次数不超过配置上限，耗尽后返回明确错误且不含密钥 — verify: 单测 mock 持续不合规，断言重试次数等于上限且错误信息中不含 key 的值

## 5. 可靠性：错误分类、重试、超时与总预算

- [x] 5.1 先做一次错误状态码验证：用错误 key 触发 401、用非法参数触发 400，确认能从错误对象中提取状态码 — verify: 能稳定拿到 HTTP 状态码；若拿不到，记录替代判别方式后再继续
- [x] 5.2 用 LangGraph `RetryPolicy` 包装 LLM 节点，参数来自配置 — verify: 单测 mock 连续失败后成功，断言重试次数符合配置
- [x] 5.3 错误分类：429 退避重试、5xx 重试、4xx 不重试 — verify: 单测分别 mock 三类错误，断言重试行为不同
- [x] 5.4 调用超时中断并计入失败 — verify: 单测 mock 慢响应（超过配置 timeout），断言调用被中断
- [x] 5.5 总调用预算：单次生成累计调用次数达到上限即停止 — verify: 单测让内层修复重试与外层节点重试同时触发，断言总次数不超过预算且不再继续调用

## 6. 可观测与成本

- [x] 6.1 实现 traceId 生成与透传（请求级贯穿到 callback） — verify: 单测验证同一次调用内 traceId 一致
- [x] 6.2 实现 LangChain callback handler：记录模型、tokens、耗时、费用估算，并按 traceId 聚合重试产生的多次用量 — verify: 单测模拟含 2 次重试的调用，断言只产生一条汇总记录且 token 数为累加值
- [x] 6.3 确保日志不记录 API key，完整 prompt 原文由开关控制且默认关闭 — verify: 断言日志输出中不含 key

## 7. 真实调用验收与收尾

- [x] 7.1 真实 DeepSeek 调用验证：结构化输出、thinking 显式关闭/开启的行为、用量汇总全链路 — verify: 返回合规结构化对象；开启/关闭 thinking 的行为与实测一致；日志含 traceId 与汇总用量且不含 key
- [x] 7.2 全量测试、lint 与格式检查 — verify: `npm test`、`npm run lint`、`npm run format:check` 全部通过
- [x] 7.3 以 conventional commit 提交本次变更 — verify: `git log` 显示提交且不含 `.env`
