# Design

## Context

动机见 `proposal.md`。此处只记录影响方案选择的现状事实（均在本次规划中实测或读源码确认）：

| 事实 | 依据 | 对方案的影响 |
| --- | --- | --- |
| 后端 55 个 `.ts`（含 17 个 `*.spec.ts`），`src` 内相对导入约 156 处 | `find` / `grep` 统计 | 扩展名改造是一次性机械劳动，量级可控 |
| `shared/` 编译为 CJS；ESM 下 `await import('@rill/shared')` 可取到具名导出 | 实跑 `node --input-type=module -e "await import('@rill/shared')"` | shared 不必跟着改 |
| Prisma 7 生成器按项目 tsconfig 推导导入后缀：`module: commonjs` 或 `moduleResolution: bundler` → 空后缀，否则 `ts→js / mts→mjs / cts→cjs` | `backend/node_modules/prisma/build/cli.js` 中 `M8t()` / `$8t()` | 改 tsconfig 后重新 `prisma generate` 即可，无需改 `schema.prisma` |
| jest 29 对非 `.js`/`.mjs`/`.cjs` 扩展名只看 `extensionsToTreatAsEsm`，默认不把 `.ts` 当 ESM | `node_modules/jest-resolve/build/shouldLoadAsEsm.js` | 即使包是 `type: module`，`.ts` 仍可按 CJS 加载 |
| 源码中无 `jest.mock`、无 `import.meta`、无顶层 `await`、无 `require()`、无 JSON 导入 | `grep` 全量排查 | 迁移不涉及这些 ESM 高危写法 |
| tsconfig 改为 `nodenext` 后，Prisma 生成的 `client.ts` 出现 `globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url))` | 重新 `prisma generate` 后查看生成物 | 测试必须以 ESM 运行（见决策 3） |
| `@prisma/client` 同时提供 `client.js` / `client.mjs`；`@nestjs/*`、`@langchain/*`、`@prisma/adapter-better-sqlite3` 均 ESM 兼容 | 读各包 `package.json` / 产物 | 无依赖升级需求 |
| 产物实际布局为 `dist/src/main.js` + `dist/generated/prisma/**`，而 `start` 脚本写的是 `node dist/main.js` | 查看 `backend/dist` | 该脚本当前即不可用，本次一并修正 |

## Goals / Non-Goals

**Goals:**

- 后端产物以 ESM 加载，源码模块解析遵循 NodeNext 规则并在编译期强制。
- 保持 `npm run build`、`npm run dev`、`npm test`、`npm run start` 四条链路可用且行为不变。
- 把「相对导入必须带扩展名」变成编译期可拦截的约束，而不是口头约定。

**Non-Goals:**

- 不改任何 HTTP 契约、不改业务行为、不改 `shared/` 与 `frontend/` 的模块格式。
- 不引入打包器、路径别名（`tsconfig` 当前无 `paths`，此约束需保持，否则 ESM 下要额外处理别名解析）。
- 不更换测试框架，不调整覆盖率门禁。
- 不迁移 `prisma7.config.ts` 的加载方式（由 Prisma 自身加载器处理）。

## Decisions

### 1. 全量 ESM：`package.json` 加 `"type": "module"` + `tsconfig` 改 `nodenext`

两者必须成对出现——`nodenext` 依据包 `type` 决定产物格式，只改其一没有意义。

- 替代方案 A：只把 `moduleResolution` 提到 `nodenext` 而保留 CJS 输出 → 解析更严格但产物仍是 CJS，收益为零。
- 替代方案 B：产出 CJS/ESM 双格式 → 本仓库后端无外部消费者，双产物只增加构建复杂度。

### 2. `shared/` 保持 CJS，后端直接以 ESM 消费

已实测具名导入可用。

- 替代方案：shared 转 ESM → jest 的 CJS 测试 `require` 一个 ESM 包会失败（jest 不走 Node 24 的 `require(esm)`），必须连带把测试改成 ESM，范围扩大。
- 替代方案：shared 双格式发布 → 需两套 tsconfig 与产物目录，当前唯一消费者是本项目，收益不抵成本。
- 约束：shared 后续若大量使用 `export *` 的间接再导出链，需重新验证具名导入的可探测性（当前单文件结构无此问题）。

### 3. 测试层：改为真 ESM 运行（实施后修正，原计划为保持 CJS）

原计划让 ts-jest 继续以 CJS 转译。实施中被证伪：tsconfig 改为 `nodenext` 后，Prisma 生成的 `client.ts` 会带上 ESM 专属的 `import.meta.url`（用于设置 `globalThis.__dirname`），CJS 下转译直接 `SyntaxError: Cannot use 'import.meta' outside a module`，6 个 suite 失败。因此改走真 ESM 测试，配置要点：

- `extensionsToTreatAsEsm: ['.ts']` + ts-jest `useESM: true`，测试脚本前置 `NODE_OPTIONS="--experimental-vm-modules --disable-warning=ExperimentalWarning"`。
- `moduleNameMapper` 把 `^(\.{1,2}/.*)\.js$` 映射回无后缀，让 jest 解析源码里的 `.js` 后缀。
- ts-jest 的 `diagnostics.ignoreCodes` 加入 `151002`（hybrid module kind 的告警，非错误）。
- ESM 下 `jest` 对象不注入全局：测试文件改用 `const jest = import.meta.jest;`（`@types/jest` 已声明 `ImportMeta.jest`，jest-runtime 也确实注入），避免 `@jest/globals` 的严格泛型导致既有 `jest.fn()` 调用点大量报错。
- `pipeline.service.spec.ts` 的 `__dirname` 改为 `import.meta.url` + `fileURLToPath`。
- **`test/setup-db.ts` 保留 `__dirname`**：jest 的 globalSetup 永远以 CommonJS 加载（`@jest/core` 的 `requireAndTranspileModule`），那里用 `import.meta` 反而会失败。

- 替代方案（已否决）：让 Prisma 生成 CJS 形态客户端 → 生成物在 `type: module` 包下会以 ESM 解析而崩溃；给测试定制 transform 剥离 `import.meta` → 维护成本高且失真。
- 替代方案（未采纳）：后端测试换 vitest，与前端统一。ESM 原生支持最好，但等于并行做两次迁移，超出本次范围。

权衡（明确接受）：`jest.mock` 在 ESM 下不可用（未来需要 mock 模块时用 `jest.unstable_mockModule`），且 ESM 测试依赖 `--experimental-vm-modules` 实验开关。当前代码库无 `jest.mock` 用法，影响为零。

### 4. Prisma 生成物：靠 tsconfig 推导，不写死 generator 选项

`backend` 的 `build` 脚本已是 `prisma generate && nest build`，tsconfig 改完后生成物会自动带上 `.js` 后缀，无需改 `schema.prisma`。

- 附带决策：`dev` 脚本（`nest start --watch`）前置 `prisma generate`。生成物被 git 忽略，开发者若只跑 `dev` 可能停留在旧的（无后缀）生成物上，从而在运行期才炸；前置后每次启动都保证与 tsconfig 一致，代价是多几秒生成时间。
- 备选：在 `generator` 块显式写 `importFileExtension = "js"` 锁死后缀。不选，因为让它随 tsconfig 自动对齐可减少一处需要人工同步的配置。

### 5. 产物布局不动，`start` 脚本修正为 `node dist/src/main.js`

`generated/prisma` 位于 `src` 之外，产物天然分成 `dist/src` 与 `dist/generated` 两棵。给 tsconfig 设 `rootDir: "src"` 会因生成物越界而报错，因此保持布局，只修脚本。

### 6. 暂不启用 `verbatimModuleSyntax`

它会强制区分类型导入与值导入，与 ts-jest 的 CJS 覆盖组合可能引入意外报错，收益与本次目标无关，留作后续可选加固。

## Risks / Trade-offs

- **[扩展名遗漏]** 新增文件忘写 `.js` 后缀 → ESM 下该相对路径无法解析，tsc 在编译期即报错（`TS2307`，部分场景提示 `TS2835`），不会漏到运行期；CI 的 build 步骤即门禁。
- **[测试依赖实验开关]** ESM 测试需要 `NODE_OPTIONS=--experimental-vm-modules`，且 `jest.mock` 不可用 → 约定写入 `AGENTS.md`；未来若需 mock 模块改用 `jest.unstable_mockModule`；若 jest 实验开关移除或行为变更，回退路径是保持运行时 ESM、把测试换成 vitest（已列为可延后事项）。
- **[生产运行时与测试仍有差异]** 测试由 ts-jest 转译、生产跑 tsc 产物 → 保留「构建 + 生产启动 + `GET /api/health` 冒烟」作为最终门禁。
- **[生成物与 tsconfig 不同步]** 手动执行顺序不当会残留旧生成物 → `build` 已含 `prisma generate`，`dev` 前置同一命令（决策 4）。
- **[Nest 装饰器元数据]** ESM 下 tsc 照常产出 `design:paramtypes`，与 CJS 约束相同：被注入的参数类型必须是值导入，写成 `import type` 会退化为 `Object` 导致 DI 失败 → 回归时重点验证依赖注入相关的 e2e。
- **[未来 mock 写法]** 一旦有人后续把测试切到 ESM，`jest.mock` 会静默失效 → 在任务中明确记录该约束，不在本次改动。
- **[回滚成本]** 全部改动集中在 `backend/package.json`、`backend/tsconfig.json`、源码导入后缀；导入后缀是机械替换，整体 `git revert` 干净，回滚成本低。

## Migration Plan

1. 记录基线：在改动前跑一次 `npm run build` 与 `npm test`，确认当前全绿，便于区分迁移引入的问题与既有问题。
2. 改 `backend/package.json`（`type: module`、`start` 脚本、`dev` 前置 `prisma generate`、jest 配置段）与 `backend/tsconfig.json`（`module` / `moduleResolution`）。
3. 批量为 `backend/src`、`backend/test` 的相对导入补 `.js` 后缀；`backend/test/jest-e2e.json` 同步 jest 配置。
4. `prisma generate` 重新生成，确认生成物导入带 `.js`。
5. 逐链路验证：`build` → `test`（单测 + e2e）→ `start` + `/api/health` 冒烟 → `dev` 热启动。
6. 回滚：`git revert` 本次提交并重新 `prisma generate`（若生成物被缓存）。

## Open Questions

以下均可延后，不影响本方案与任务拆分：

- 未来是否把后端测试统一到 vitest（与前端一致），从而顺带获得原生 ESM 测试。
- 是否给 `shared/` 做 ESM/CJS 双格式发布（仅在出现外部消费者或具名导入探测失败时需要）。
- 是否启用 `verbatimModuleSyntax` 做进一步加固。
