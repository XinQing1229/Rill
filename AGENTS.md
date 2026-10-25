# AGENTS.md

本文件为 AI 编码助手提供项目上下文与协作约定。人类开发者请先读 `README.md`。

## 项目简介

Rill —— 小说创作 Agent：通过结构化问卷收集创作意图，按多阶段流水线（种子 → 世界观 → 人物 → 大纲 → 正文）生成小说，并上传到小说平台。当前阶段：流水线基础与 AI 基建已完成，正文创作与交付能力持续完善。

## 技术栈与结构

- npm workspaces monorepo，Node 24（`.nvmrc`）+ npm 11+
- `backend/`：NestJS 11 + TypeScript，端口 3000，全局前缀 `/api`
- `frontend/`：Vite + React 19 + Ant Design 5 + TypeScript，端口 5173，`/api` 代理到后端
- `shared/`：`@rill/shared`，前后端共享的 API 契约类型与 zod schema（契约变更必须改这里）
- `openspec/`：OpenSpec 变更与能力规范（spec-driven 开发）
- AI：LangChain + LangGraph + DeepSeek（OpenAI 兼容协议，`https://api.deepseek.com`）
- 数据库：Prisma 7 + SQLite（`backend/prisma/schema.prisma`，client 生成到 `backend/generated/prisma`）

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm install` | 安装全部工作区依赖 |
| `npm run dev` | 启动前后端 dev server（先构建 shared） |
| `npm run build` | 按 shared → backend → frontend 顺序构建 |
| `npm test` | 运行所有工作区测试 |
| `npm run lint` | 运行所有工作区 lint |
| `npm run format` | Prettier 格式化全仓库 |
| `npm run test -w @rill/backend` | 仅后端测试（jest，`*.spec.ts` 与源码同目录；e2e 在 `backend/test/`） |
| `npm run test -w @rill/frontend` | 仅前端测试（vitest + Testing Library） |

## 开发流程（必须遵守）

1. **提交信息用 conventional commits**：`feat:` / `fix:` / `chore:` / `docs:` / `test:` / `refactor:`。
2. **契约先行**：新增/修改 API 时，先在 `shared/src/index.ts` 定义 zod schema 与类型，后端校验、前端消费都基于它；结构化 LLM 输出同样用 zod schema 约束。
3. **测试**：后端行为用 jest 单测覆盖（与源码同目录的 `*.spec.ts`），HTTP 层用 `backend/test/` 下的 supertest e2e；前端组件用 vitest。提交前确保 `npm test` 与 `npm run lint` 通过。

> OpenSpec 流程（`/opsx:propose` → `apply` → `verify` → `archive`）为可选的变更管理工具，按需使用，不再作为功能变更的前置要求。

## 领域约定（小说流水线）

- **问卷先行**：生成种子前必须收集问卷答案，必答 3 项（`genre`、`length`、`pov`）缺失时拒绝生成，并返回缺失项名称。
- **已选维度不交给模型**：用户在问卷中明确选择的维度（类型、篇幅、视角、文风等）直接采用，禁止让模型生成，避免与作者选择冲突。`PremiseSchema` 因此不含这些字段。
- **推进模式**：默认 `manual`（每阶段生成后待确认，确认才推进）；`auto` 连续推进，失败停在该阶段，可从失败阶段续跑，不重复已完成阶段。
- **防重与回退**：生成中拒绝同一阶段的重复生成请求；回退到已完成阶段时，其下游所有阶段产物标记为 stale，需重新生成。
- 阶段定义、产物 schema 的权威来源是 `shared/src/index.ts` 与 `openspec/specs/novel-pipeline/spec.md`，实现与之冲突时以规范为准并先修规范。

## 后端实现约定

- Prisma + SQLite 限制：无 enum、无 Json 类型——枚举用 String 存储，结构化内容存 JSON 字符串（读写时用 zod 校验）。
- AI 能力统一走 `backend/src/ai/`：模型注册表（`models/model.registry.ts`）、提示词注册表（`prompts/prompt.registry.ts`）、错误分类（`errors/error-classifier.ts`）、用量记录（`observability/usage-recorder.ts`）。新 AI 功能优先复用这些基建，不要把 prompt/model 硬编码在业务代码里。
- token 用量记录到 `Project`/`Premise` 的 `promptTokens`/`completionTokens` 字段。
- 后端为 ESM（`backend/package.json` 的 `type: module` + tsconfig 的 `module: nodenext`）：
  - 相对导入必须带 `.js` 扩展名（如 `./app.module.js`）；缺失时 ESM 下无法解析，tsc 报 `TS2307`（或提示补扩展名的 `TS2835`），构建期即拦截；不要引入路径别名。
  - 不在源码里使用 `__dirname` / `require()`，ESM 下用 `import.meta.url` + `fileURLToPath` 推导目录。
  - 测试同样以 ESM 运行（`NODE_OPTIONS=--experimental-vm-modules`）：`jest` 对象不注入全局，需写 `const jest = import.meta.jest;`；`jest.mock` 不可用，需要 mock 模块时改用 `jest.unstable_mockModule`。jest 的 globalSetup 仍以 CommonJS 加载，那里可用 `__dirname`。
  - 改完 tsconfig 后必须重新 `prisma generate`——Prisma 生成物的导入后缀由 tsconfig 推导（`build` 与 `dev` 脚本已内置该步骤）。

## 安全红线

- `DEEPSEEK_API_KEY` 等密钥只写入 `backend/.env`（已被 git 忽略，仓库只提交 `.env.example`），**严禁提交到仓库或写入日志**。
- 不要提交 `backend/dev.db`、`*.db`、`dist/`、`backend/generated/` 等生成物。

## 代码风格

- TypeScript strict；后端 NestJS 模块化（`*.module.ts` / `*.controller.ts` / `*.service.ts` 命名约定），前端函数组件 + hooks。
- 注释与文档使用中文（与现有代码保持一致）。
- Prettier 统一格式，提交前跑 `npm run format`。
