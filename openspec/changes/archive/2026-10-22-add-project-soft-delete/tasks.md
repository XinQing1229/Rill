# Tasks

## 1. 数据层：删除标记与迁移

- [x] 1.1 在 `backend/prisma/schema.prisma` 的 `Project` 上增加 `deletedAt DateTime?` 并添加 `@@index([deletedAt])`，确认与现有 6 张表的 `onDelete: Cascade` 无冲突
- [x] 1.2 新增 migration `YYYYMMDDHHMMSS_project_soft_delete`（SQLite RedefineTables 风格，参考 `20261022053132_stage_run_stale`），执行 `npx prisma migrate dev` 并通过 `npx prisma generate` 重新生成 client（构建成功且既有查询不受影响）

## 2. 共享契约

- [x] 2.1 在 `shared/src/index.ts` 为 `ProjectSummary` 与 `ProjectDetail` 增加 `deletedAt: string | null`，保持与既有 `createdAt/updatedAt` 一致的 `string` 类型风格
- [x] 2.2 新增回收站查询参数的 zod schema（如 `ProjectScopeSchema = z.enum(['active', 'trash']).optional()`）与端点所需空 body schema，供 `ZodValidationPipe` 使用；通过 `npm run build -w @rill/shared` 验证

## 3. 后端：可见性收窄

- [x] 3.1 在 `PipelineService` 引入可见性常量（`{ deletedAt: null }`），让 `get()`、`list()`、`characters()`、`relations()` 等全部读路径统一排除已删除项目，并校验 `get()` 对已删除项目仍抛 `NotFoundException`
- [x] 3.2 修正 `onModuleInit` 的重启清理 `updateMany`，补 `deletedAt: null` 条件，确保回收站项目的 `status/runId` 不被改写
- [x] 3.3 单元测试：删除后对 `get/list/characters/relations` 断言 404 或列表缺失，且重启清理不影响回收站项目（`backend/src/novel/pipeline/*.spec.ts`，真实 SQLite）

## 4. 后端：软删除与恢复

- [x] 4.1 实现 `softDelete(id)`：单次 `updateMany`（`deletedAt: null, status != running, runId: null`）判定 404/409/成功三态，返回含 `deletedAt` 的项目摘要
- [x] 4.2 实现 `restore(id)`：`updateMany` 将 `deletedAt` 置空，`count !== 1` 时 404
- [x] 4.3 单元测试：软删除幂等（二次删除 404）、running 时删除返回 409、恢复后 `answers`/`currentStage`/`mode`/产物/`stale`/`StageRun` 与删除前完全一致、恢复后同一 `title` 项目重新出现在列表

## 5. 后端：回收站检索与永久删除

- [x] 5.1 实现回收站列表：按 `deletedAt` 倒序，仅返回 `deletedAt != null` 的项目，字段与 `ProjectSummary` 对齐（含 `deletedAt`）
- [x] 5.2 实现单个永久删除：`$transaction` 内先 `outlineUsage.deleteMany({ projectId })` 再 `project.delete`，事务外调用 `checkpointer.deleteThread(id)` 并 warn 日志兜底
- [x] 5.3 实现清空回收站：按 5.2 的流程对回收站内项目逐一永久删除，返回清理数量
- [x] 5.4 单元测试：永久删除后 Premise/World/Character/Relation/Outline/StageRun/OutlineUsage 全部为空且 `checkpointer.getTuple({ configurable: { thread_id } })` 返回空；清空回收站返回正确数量

## 6. 后端：运行期守卫

- [x] 6.1 在 `runGraph` 的阶段节点前置 `assertActive(id)`，项目已删除时中断图执行
- [x] 6.2 让 `releaseRun` 与产物写入路径带 `deletedAt: null` 条件，count 为 0 时静默丢弃
- [x] 6.3 单元测试：模拟「删除先于后台任务完成」，断言产物与 `StageRun` 保持删除时刻内容、项目状态不被回滚

## 7. 后端：HTTP 层

- [x] 7.1 在 `novel.controller.ts` 新增 `DELETE /projects/:id`、`POST /projects/:id/restore`、`DELETE /projects/:id/permanent`，并为 `GET/DELETE /projects` 增加 `scope=trash` 查询参数
- [x] 7.2 e2e 测试（`backend/test/novel.e2e-spec.ts` 或新增 `project-trash.e2e-spec.ts`）：软删后 `GET /projects/:id` 404、`GET /projects` 不含该项、`GET /projects?scope=trash` 含该项；restore 后再可见；running 时删除 409；永久删除后 404
- [x] 7.3 将现有 e2e 的 `beforeAll` 清理改为物理删除或带 `deletedAt` 过滤，避免测试遗留的已删除项目污染既有断言（`npm run test -w @rill/backend` 全绿）

## 8. 前端：接口与列表视图

- [x] 8.1 在 `frontend/src/api/client.ts` 新增 `del<T>()`（复用现有 `ApiError` 分支），并在 `api/novel.ts` 新增 `deleteProject/restoreProject/purgeProject/clearTrash/listTrash`
- [x] 8.2 在 `ProjectListPage.tsx` 增加「创作中 / 回收站」切换（默认 `scope`）、每行删除 `Popconfirm`（说明可到回收站恢复），失败时展示后端文案且不乐观更新
- [x] 8.3 回收站视图：展示标题、类型与删除时刻（复用 `lib/stage.ts` 的时间格式化），提供恢复与永久删除 `Popconfirm`（不可撤销提示）以及 `Modal.confirm` 的清空回收站
- [x] 8.4 校验 `useProjectCount` 的计数仍基于默认列表（不含回收站项目）

## 9. 前端测试与全量校验

- [x] 9.1 扩展 `ProjectListPage.test.tsx`：覆盖删除确认、列表移除、回收站切换、恢复后回到列表、永久删除确认、失败文案展示（`npm run test -w @rill/frontend` 通过）
- [x] 9.2 运行 `npm run build`、`npm test`、`npm run lint` 全部通过，并手工冒烟：创建 → 生成至待确认 → 删除 → 回收站可见 → 恢复后仍在待确认 → 永久删除后完全消失
