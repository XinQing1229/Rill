# Tasks

## 1. 基线确认

- [x] 1.1 记录迁移前基线：执行 `npm run build -w @rill/backend` 与 `npm test -w @rill/backend`，确认构建与测试当前结果（`npm run start` 已知因产物路径不可用，不纳入基线），以便在后续步骤中区分既有问题与迁移引入的问题 —— 基线：构建通过；单测 17 suites / 142 tests、e2e 2 suites / 13 tests 全绿

## 2. 切换模块格式配置

- [x] 2.1 在 `backend/package.json` 增加 `"type": "module"`，并确认 `backend` 之外的两个工作区（`shared`、`frontend`）不受影响（根 `package.json` 无 `type` 字段）
- [x] 2.2 将 `backend/tsconfig.json` 的 `module` 改为 `nodenext`、`moduleResolution` 改为 `nodenext`（`tsconfig.build.json` 继承同一文件，无需重复改），确认 tsc 开始对无扩展名的相对导入报解析失败（`TS2307`）
- [x] 2.3 修正 `backend/package.json` 的 `start` 脚本为 `node dist/src/main.js`，并把 `dev` 脚本改为前置 `prisma generate`（保证 watch 启动前生成物与 tsconfig 一致）

## 3. 相对导入补齐 `.js` 扩展名

- [x] 3.1 为 `backend/src` 下约 156 处相对导入补 `.js` 后缀（含 `export * from './x'` 形式），验证方式：`npx tsc -p backend/tsconfig.build.json --noEmit` 无解析失败报错 —— 实际改造 160 处（src + test，其中目录导入 0 处）；用临时探针复验：补回无后缀导入时 tsc 报 `TS2307`，删除探针后 `npm run build -w @rill/backend` 通过
- [x] 3.2 为 `backend/test` 下 `health.e2e-spec.ts`、`novel.e2e-spec.ts`、`setup-db.ts` 的相对导入补 `.js` 后缀，验证方式：全量 `tsc --noEmit`（含 `test/**`）通过
- [x] 3.3 确认改造后仍不存在路径别名、`require()`、JSON 导入等与 ESM 冲突的写法，验证方式：对 `backend/src`、`backend/test` 检索 `require(`、`from '.*\.json'`、`import.meta`，结果为空（仅剩测试文件中刻意使用的 `import.meta.jest` / `import.meta.url`）

## 4. 重新生成 Prisma 客户端

- [x] 4.1 执行 `npm run build -w @rill/backend` 触发 `prisma generate`，检查 `backend/generated/prisma` 内部相对导入已带 `.js` 后缀（例如 `client.ts` 中的 `./enums.js`）
- [x] 4.2 确认 `backend/src/novel/prisma.service.ts` 对 `../../generated/prisma/client.js` 的导入在 ESM 解析下可用，验证方式：单元测试中涉及 Prisma 的用例可正常实例化服务 —— 17 个 spec 全部通过

## 5. 调整 jest 配置（改为真 ESM 运行）

> 原计划让测试保持 CJS，实施中被证伪：Prisma 在 `nodenext` 下生成的 `client.ts` 使用了 `import.meta.url`，CJS 转译直接报错（6 个 suite 失败）。改为真 ESM 测试，依据见 `design.md` 决策 3。

- [x] 5.1 在 `backend/package.json` 的 jest 配置段中启用 `extensionsToTreatAsEsm: ['.ts']`、ts-jest `useESM: true` 与 `diagnostics.ignoreCodes: [151002]`，并添加 `moduleNameMapper` 将 `^(\.{1,2}/.*)\.js$` 映射为 `$1`
- [x] 5.2 同步 `backend/test/jest-e2e.json` 应用相同配置，并把 `test` / `test:unit` / `test:e2e` 脚本前置 `NODE_OPTIONS="--experimental-vm-modules --disable-warning=ExperimentalWarning"`
- [x] 5.3 ESM 下 `jest` 对象不注入全局：为 7 个 spec 与 `novel.e2e-spec.ts` 增加 `const jest = import.meta.jest;`；`pipeline.service.spec.ts` 的 `__dirname` 改为 `import.meta.url` + `fileURLToPath`；`test/setup-db.ts` 保留 `__dirname`（jest 的 globalSetup 始终以 CJS 加载）
- [x] 5.4 执行 `npm test -w @rill/backend`（单测 + e2e）全部通过，验证方式：17 个 `*.spec.ts` / 142 tests 与 2 个 e2e / 13 tests 与基线一致

## 6. 端到端验证

- [x] 6.1 执行 `npm run build`（根，shared → backend → frontend 顺序）全部成功，验证方式：命令退出码为 0 且 `backend/dist/src/main.js` 存在
- [x] 6.2 以生产方式启动后端并冒烟：`npm run start -w @rill/backend` 后请求 `GET /api/health` 返回存活响应（这是唯一覆盖真 ESM 运行时的验证，必须执行）—— 返回 `{"status":"ok",...}`，日志显示 Nest 应用启动成功
- [x] 6.3 验证开发链路：`npm run dev -w @rill/backend` 能启动并在改动文件后热重启成功 —— 首次启动成功，改动 `health.controller.ts` 内容后日志出现第二次 `Nest application successfully started`
- [x] 6.4 执行 `npm run lint` 与 `npm run format:check`（根）通过，验证方式：无新增 lint 错误、无格式差异 —— 说明：`npm run format` 是仓库级命令，顺带把 14 个 `frontend/` 文件的既有格式漂移一并规范化了（纯格式、无逻辑改动），经确认保留，与前端模块格式无关

## 7. 固化约定

- [x] 7.1 在 `AGENTS.md` 的后端实现约定中补充：后端为 ESM，新增代码的相对导入必须带 `.js` 扩展名（tsc 会在编译期拦截）；测试以 ESM 运行，`jest` 对象需通过 `import.meta.jest` 获取、`jest.mock` 需改用 `unstable_mockModule`；改完 tsconfig 后必须重新 `prisma generate`
