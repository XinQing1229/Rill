# AGENTS.md

本文件为 AI 编码助手提供项目上下文与协作约定。人类开发者请先读 `README.md`。

## 项目简介

Rill —— 小说创作 Agent：通过结构化问卷收集创作意图，按多阶段流水线（种子 → 可选世界观 → 人物与关系 → 大纲 → 正文）创作小说。正文支持逐章生成、审核、修改预览、摘要和人工接受；小说平台上传尚未实现。项目仅供本地 Web 端使用，不进行部署。

## 技术栈与结构

- npm workspaces monorepo，Node 24（`.nvmrc`）+ npm 11+
- `backend/`：NestJS 11 + TypeScript，端口 3000，全局前缀 `/api`
- `frontend/`：Vite + React 19 + Ant Design 5 + TypeScript，端口 5173，`/api` 代理到后端
- `shared/`：`@rill/shared`，前后端共享的 API 契约类型与 zod schema（契约变更必须改这里）
- `docs/`：设计与验收文档（部分为历史方案记录，以代码实现为准）
- AI：LangChain + LangGraph + DeepSeek / 智谱 GLM-5.3（OpenAI 兼容协议）
- 数据库：Prisma 7 + SQLite（`backend/prisma/schema.prisma`，client 生成到 `backend/generated/prisma`）

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm install` | 安装全部工作区依赖 |
| `npm run dev` | 启动前后端 dev server（先构建 shared） |
| `npm run build` | 按 shared → backend → frontend 顺序构建 |
| `npm test` | 运行所有工作区测试 |
| `npm run lint` | 运行所有工作区 lint |
| `npm run format:check` | 检查全仓库格式，不写入文件 |
| `npm run format` | Prettier 格式化全仓库，会修改文件 |
| `npm run test -w @rill/backend` | 仅后端测试（jest，`*.spec.ts` 与源码同目录；e2e 在 `backend/test/`） |
| `npm run test -w @rill/frontend` | 仅前端测试（vitest + Testing Library） |

## 开发流程（必须遵守）

1. **先理解需求**：开始执行前先确认任务目标和用户需求；如果目标不明确，先询问用户。
2. **保持最小实现**：用最小、最直接的代码解决问题，不添加用户未要求的功能。
3. **提交信息用 conventional commits**：`feat:` / `fix:` / `chore:` / `docs:` / `test:` / `refactor:`。
4. **契约先行**：新增/修改 API 时，先在 `shared/src/index.ts` 定义 zod schema 与类型，后端校验、前端消费都基于它；结构化 LLM 输出同样用 zod schema 约束。
5. **测试与检查**：后端行为用 jest 单测覆盖（与源码同目录的 `*.spec.ts`），HTTP 层用 `backend/test/` 下的 supertest e2e；前端组件用 vitest。根据改动运行相关测试、lint 和构建；提交前评估是否需要全量验证。格式检查优先使用 `npm run format:check`；需要格式化时只格式化相关文件，避免无关改动。
6. **开发结束检查 README**：每次开发完毕都要查看 `README.md`，判断本次变更是否影响用户可见功能、使用步骤、配置、命令或限制；如有影响，同步更新 README。若无需更新，也应明确检查过，避免文档与实现不一致。

> 本项目不再使用 OpenSpec 管理变更，`openspec/` 目录仅作历史记录，新功能不需要创建 change，也不要在其中新增或更新规范。

## 领域约定（小说流水线）

- **问卷先行**：生成种子前必须收集问卷答案，必答 3 项（`genre`、`length`、`pov`）缺失时拒绝生成，并返回缺失项名称。
- **已选维度不交给模型**：用户在问卷中明确选择的维度（类型、篇幅、视角、文风等）直接采用，禁止让模型生成，避免与作者选择冲突。`PremiseSchema` 因此不含这些字段。
- **推进模式**：默认 `manual`（阶段产物生成后待确认，确认才推进）；`auto` 连续推进，失败停在该阶段，可从失败阶段续跑，不重复已完成阶段。正文阶段两种模式都逐章等待人工接受。
- **防重与回退**：生成中拒绝同一阶段的重复生成请求；回退到已完成阶段时，其下游所有阶段产物标记为 stale，需重新生成。
- 阶段与共享产物契约以 `shared/src/index.ts` 为准；用户可见行为以代码实现为准，`docs/` 下的设计文档仅作背景与历史参考。实现与文档描述不一致时，以当前需求意图为准，同步修正实现或文档，不得静默让二者长期冲突。

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

- 用户在设置页保存的模型 API Key 加密后写入本地 SQLite；先使用用户 Key，再回退到 `backend/.env` 中同一服务商的 Key。`LLM_CREDENTIAL_ENCRYPTION_KEY` 只保存在被 git 忽略的 `backend/.env` 中。所有密钥均**严禁提交到仓库或写入日志**。
- 不要提交 `backend/dev.db`、`*.db`、`dist/`、`backend/generated/` 等生成物。

## 代码风格

- TypeScript strict；后端 NestJS 模块化（`*.module.ts` / `*.controller.ts` / `*.service.ts` 命名约定），前端函数组件 + hooks。
- 注释与文档使用中文（与现有代码保持一致）。
- Prettier 统一格式；优先运行 `npm run format:check`，需要格式化时只处理本次改动文件。
