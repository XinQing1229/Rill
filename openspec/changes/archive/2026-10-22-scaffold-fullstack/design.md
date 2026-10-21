# Design

## Context

空仓库起步（仅有 README）。本机环境：Node 24.21.0、npm 11.19.0，无 pnpm/yarn。DeepSeek 连通性已在探索阶段用真实调用验证：`https://api.deepseek.com` 与 OpenAI SDK 完全兼容；`deepseek-flash` 默认不推理（`reasoning_tokens: 0`），仅显式传 `thinking: {type: "enabled"}` 时开启。动机见 proposal.md - Why。

## Goals / Non-Goals

**Goals:**

- 一条命令启动前后端 dev server 的 monorepo 骨架
- 经真实调用验证的 LLM 通道（ping 端点）
- 每个工作区有可运行测试基线
- 工程规范从第一天生效（格式化、lint、Node 版本、提交规范）
- 密钥只存在于 gitignore 的 `.env`

**Non-Goals:**

- 不做数据库/持久化、不做部署/CI、不做 SSE 端到端（仅预留 `stream()` 签名）
- 不写任何小说领域逻辑（大纲/章节/上传）——属于后续 change
- 不做鉴权与多用户

## Decisions

### 决策 1：npm workspaces monorepo（三包：backend / frontend / shared）

- **理由**：本机 npm 11 原生支持 workspaces，零额外工具依赖；单一 lockfile；`shared` 包让前后端共享 API 契约类型。
- **备选**：pnpm（更快更严格，但本机未装，引入工具依赖）；拆成两个独立仓库（工具链配置重复，共享类型要靠发包或拷贝）。

### 决策 2：NestJS 后端，按功能分模块

- **结构**：`AppModule` + `ConfigModule`（`@nestjs/config` 全局加载）+ `LlmModule`（service + controller）+ `HealthController`。默认端口 3000。
- **理由**：DI 与模块化模式适配后续 agent 功能（大纲、章节、上传各自成模块）。
- **备选**：裸 Express/Fastify（自由度更高但缺少约束，功能变多后易乱）。

### 决策 3：`openai` npm SDK + `baseURL` 覆盖接 DeepSeek

- **理由**：DeepSeek 与 OpenAI 协议兼容（已验证），零协议开发成本；将来换提供商只改配置。
- **备选**：手写 fetch 客户端（控制力强但错误处理和类型都要自理，不值）。

### 决策 4：环境配置走 `@nestjs/config` + `.env`

- **变量**：`DEEPSEEK_API_KEY`（必填）、`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）、`DEEPSEEK_MODEL`（默认 `deepseek-flash`）。
- **理由**：Nest 原生方案，启动时集中校验，缺 key 时启动即报错而非运行到一半才失败。
- **安全**：`.env` 进 `.gitignore`；`.env.example` 只放占位符；key 不打日志、不进响应。

### 决策 5：模型策略——flash 默认，pro 可选，thinking 按需

- **理由**：探索阶段已验证 flash 默认关闭推理、便宜快，适合草稿；`deepseek-v4-pro` 留给大纲/设定类重推理；`thinking` 与 `reasoning_effort` 按调用显式开启（开启会吃 `max_tokens` 预算）。
- **实现**：`llm` service 暴露 `complete()` 与预留的 `stream()`；模型与开关由调用方参数控制，配置提供默认值。

### 决策 6：前端 Vite + React + TypeScript + Ant Design 5

- **理由**：antd 由项目负责人选定；v5 为 CSS-in-JS，Vite 中零配置即用（无需按需引入插件）。
- **Demo 页面**：Layout 外壳（header/sider/content）+ 健康状态卡片 + LLM ping 卡片。
- **联调**：Vite dev server 将 `/api` 代理到后端 3000，前端代码不感知跨域。
- **备选**：Next.js（本工具无需 SSR，徒增复杂度）；CRA（已停止维护）。

### 决策 7：`shared` 包只放 API 契约类型

- 初始仅含 health/ping 的响应类型（约 10 行）。前后端 import 同一份定义，避免类型漂移；领域模型（大纲、章节）随首个真实功能加入。

### 决策 8：测试选型——后端 Jest / 前端 Vitest

- **理由**：Jest 是 Nest 默认；Vitest 与 Vite 同源，前端测试零额外配置。根目录 `npm test` 经 workspaces 依次执行两边。
- **范围**：scaffold 阶段每边一个冒烟测试（后端：health 端点返回 200；前端：App 渲染）。

### 决策 9：规范基线

Prettier + typescript-eslint、`.nvmrc` 锁 24、`engines: node >=24`、conventional commits（`feat:`/`fix:`/`chore:` 等）。

## Risks / Trade-offs

- [密钥经对话明文传输过，存在泄露风险] → 只写入 gitignore 的 `.env`；scaffold 完成后负责人轮换 key
- [ping 的 `max_tokens` 设太小会被推理预算吃空] → ping 调用使用宽松的 `max_tokens`，且默认不开启 thinking
- [npm workspaces 提升依赖与 Nest CLI 的预期路径可能冲突] → Nest CLI 在 backend 工作区内执行；关键依赖锁死版本
- [antd v5 包体偏大] → 内部工具可接受；后续按路由懒加载优化
- [多人机器 Node 版本漂移] → `.nvmrc` + `engines` 双保险
- [未来 SSE 端到端需要改 llm 模块结构] → 现在即定义 `stream()` 方法签名，ping 端点暂不使用

## Migration Plan

不适用（greenfield 脚手架）。回滚方式：revert 本次 change 的提交即可。

## Open Questions

- 提供商配置命名：暂用 `DEEPSEEK_*` 前缀；若未来接多家提供商，可在配置层加映射改名，不影响 spec 与结构——留到有多提供商需求时再定。
- CI/CD 与部署方案：进入部署范围时再选型。
