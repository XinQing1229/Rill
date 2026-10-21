# Tasks

## 1. Monorepo 骨架与规范基线

- [x] 1.1 创建根 `package.json`（npm workspaces：backend/frontend/shared；`dev` 脚本一键起两端；`test` 脚本跑全部工作区）— verify: `npm run` 能列出 dev/test 脚本
- [x] 1.2 创建 `.gitignore`（含 `node_modules`、`dist`、`.env`）、`.nvmrc`（24）、`.editorconfig`、根 Prettier 与 ESLint 配置 — verify: `npx prettier --check .` 通过，且 `git status` 不显示 `.env`/`node_modules`
- [x] 1.3 以 conventional commit 提交骨架（`chore:` 前缀）— verify: `git log` 显示该提交且未包含 `node_modules`

## 2. Backend（NestJS）

- [x] 2.1 在 `backend/` 生成 NestJS 项目骨架（main.ts、app.module.ts、tsconfig），默认端口 3000 — verify: `npm run start:dev -w backend` 启动后可访问 localhost:3000
- [x] 2.2 接入 `@nestjs/config`：全局 ConfigModule、`.env.example`（DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL 占位符）、本地 `.env` 填真实 key — verify: 缺 key 时启动报清晰错误；有 key 时启动成功
- [x] 2.3 实现 `HealthController`：`GET /api/health` 返回存活状态 — verify: `curl localhost:3000/api/health` 返回 200 且 body 含状态信息
- [x] 2.4 实现 `LlmModule` service：`openai` SDK 客户端（baseURL 覆盖为 DEEPSEEK_BASE_URL）、`complete()` 方法、预留 `stream()` 签名 — verify: 单元测试 mock SDK，验证 model/baseURL/apiKey 均来自配置
- [x] 2.5 实现 `LlmController`：`POST /api/llm/ping` 发起真实调用并返回结果；失败时返回原因且不含 key — verify: 配置有效时 curl 返回 completion；key 置空时返回错误且响应体与日志中均无 key
- [x] 2.6 后端测试基线：health 的 e2e 测试（supertest）+ llm service 单元测试 — verify: `npm test -w backend` 全部通过

## 3. Shared 包

- [x] 3.1 创建 `@rill/shared` 包：health 与 ping 的响应契约类型及构建配置 — verify: backend 与 frontend 均可 import 且 `tsc` 无错误

## 4. Frontend（Vite + React + Ant Design）

- [x] 4.1 在 `frontend/` 生成 Vite react-ts 项目，接入 `antd` 与 `@ant-design/icons`，`vite.config.ts` 将 `/api` 代理到 3000 — verify: `npm run dev -w frontend` 启动后页面可访问且 `/api` 请求被代理到后端
- [x] 4.2 实现应用外壳：antd Layout + 健康状态卡片（调用 `GET /api/health`，使用 shared 类型） — verify: 后端运行时页面正确展示健康状态
- [x] 4.3 实现 LLM ping 卡片：按钮触发 `POST /api/llm/ping`，展示返回结果或可读错误 — verify: 点击后页面展示真实 completion 或失败原因
- [x] 4.4 前端测试基线：App 渲染冒烟测试（Vitest + @testing-library/react） — verify: `npm test -w frontend` 通过

## 5. 联调与收尾

- [x] 5.1 根脚本联通：`npm run dev` 一键起两端；README 补齐开发者文档（环境要求、配置步骤、命令清单） — verify: 按 README 步骤可从零复现整个启动流程
- [x] 5.2 端到端验收：浏览器走查「健康状态展示」与「真实 LLM ping」两个主场景 — verify: 两个场景均成功，对应 spec 全部主场景有实证
- [ ] 5.3 提交全部代码，并轮换此前在对话中明文传输过的 DeepSeek API key — verify: 提交历史不含 `.env`；负责人确认新 key 可用
