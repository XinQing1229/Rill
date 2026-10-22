# Proposal

## Why

后端（`backend/`）目前以 CommonJS 构建与运行（`package.json` 无 `type` 字段、`tsconfig.json` 为 `module: commonjs`），而项目其余部分与主要依赖已全面 ESM 化：Node 24 运行时、前端 Vite 原生 ESM、`@prisma/client` 7 同时提供 `client.js` / `client.mjs` 双格式入口。维持 CJS 靠的是 Node 24 的 `require(esm)` 兜底，属于被动兼容，且使后端无法使用 `import.meta`、顶层 `await` 等 ESM 能力，也让测试与运行时处于两套模块语义之下。

本次变更把后端统一到 ESM：`dist` 产物以 ESM 加载，源码相对导入遵循 NodeNext 解析规则（编译期强制），从而让开发、构建、运行、测试四者对模块格式的理解一致，并移除对 `require(esm)` 兜底的隐性依赖。

## What Changes

- `backend/package.json` 增加 `"type": "module"`，后端产物以 ESM 加载。
- `backend/tsconfig.json` 的 `module` 由 `commonjs` 改为 `nodenext`（`moduleResolution` 随之 `nodenext`），使 tsc 按 Node 的 ESM 规则校验导入。
- `backend/src` 与 `backend/test` 中的相对导入（当前约 156 处）补齐 `.js` 扩展名，例如 `from './app.module'` → `'./app.module.js'`；缺少扩展名时 ESM 下无法解析，tsc 报 `TS2307`（或提示补扩展名的 `TS2835`），编译期即可拦截。
- 重新执行 `prisma generate`：Prisma 7 的 `prisma-client` 生成器会读取项目 tsconfig 推导导入后缀（`module: commonjs` 或 `moduleResolution: bundler` 时生成无后缀导入，否则 `ts→js`），tsconfig 改完后生成物自动带上 `.js` 后缀，与 ESM 运行时对齐。
- jest 保持以 CommonJS 语义转译并运行 `.ts`（jest 29 对非 `.js`/`.mjs`/`.cjs` 扩展名只看 `extensionsToTreatAsEsm`，默认不把 `.ts` 当 ESM），通过 ts-jest 覆盖 `module: commonjs` 与 `moduleNameMapper` 去掉 `.js` 后缀完成解析。
- 修正 `backend/package.json` 的 `start` 脚本：`node dist/main.js` 改为 `node dist/src/main.js`（产物实际位于 `dist/src/`，该脚本当前即不可用）。
- **`shared/`（`@rill/shared`）保持不变**，仍以 CJS 发布；已实测 ESM 下 `await import('@rill/shared')` 可正常取到具名导出，后端 ESM 直接消费 CJS 契约包无阻塞。前端不受影响。

**非目标（Non-goals）**：不改动任何 HTTP 接口、请求/响应契约与业务行为；不修改 `shared/` 与 `frontend/` 的模块格式；不迁移测试框架（jest 保留）；不引入路径别名或打包器。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dev-environment`：新增「后端以 ESM 模块格式构建与运行」要求——启动、构建、测试三条链路必须在 ESM 产物与 NodeNext 导入规则下保持可用，且这一约束由编译期强制。

## Impact

- **代码**：`backend/src` 全部 55 个 `.ts`（含 17 个 `*.spec.ts`）、`backend/test` 下 2 个 e2e 与 `setup-db.ts`；`backend/prisma/schema.prisma` 无需改动（生成物后缀由 tsconfig 推导）。
- **配置**：`backend/package.json`（`type`、`start` 脚本、jest 配置段）、`backend/tsconfig.json`、`backend/test/jest-e2e.json`。
- **生成物**：`backend/generated/prisma/**` 需重新生成（`generated/` 已被 git 忽略，CI 与本地均依赖 `prisma generate`，与现状一致）。
- **依赖**：`@prisma/client`、`@prisma/adapter-better-sqlite3`、`@nestjs/*`、`@langchain/*` 均为双格式或 ESM 兼容，无需升级；`ts-jest` / `jest` 版本不变。
- **行为**：无对外可观察行为变化；健康检查、LLM 连通性验证、小说流水线接口与响应结构均保持不变。
