# Proposal

## Why

小说项目承载了问卷答案、种子、世界观、人物、大纲等大量 AI 生成产物，一旦误删无法找回，作者会被迫重做整条流水线（无法恢复的模型输出与 token 消耗也无法追回）；而当前 `Project` 既没有删除入口也没有 `deletedAt` 之类的标记，所有关联表又都配置了 `onDelete: Cascade`，任何一次物理删除都会连带抹掉全部阶段产物与用量记录（无外键的 `OutlineUsage` 还会留下孤儿行）。因此需要在 PRD 语义之上补一层可逆的「软删除 + 回收站」：让项目可删除、可找回，明确生成产物在删除期间不被触碰。

## What Changes

- 新增项目软删除：`DELETE /api/novel/projects/:id` 标记 `deletedAt` 而非物理删除，处于回收站的项目从默认列表、详情、用量统计与流水线操作中隐藏。
- 新增恢复：`POST /api/novel/projects/:id/restore` 清空 `deletedAt`，项目连同其各阶段产物、stage 状态与 `stale` 标记按删除瞬间的样子回到创作列表。
- 新增回收站视角与永久删除：`GET /api/novel/projects?scope=trash` 列出已删除项目，支持 `DELETE /api/novel/projects/:id/permanent`（依赖现有 `onDelete: Cascade` 清理产物，并单独清理无外键的 `OutlineUsage`）与清空回收站。
- 运行时约束：`status=running` 的项目在执行期间拒绝软删除（与「回退、模式切换」同族，返回 409），避免恢复后状态撕裂；对已删除项目的一切创作类操作（生成、确认、回退、模式切换、产物读写）返回 404。
- 数据层：为 `Project` 增加可空 `deletedAt DateTime?` 与索引，走 SQLite RedefineTables migration；默认读取路径统一带 `deletedAt: null` 过滤。
- 契约层：`ProjectSummary`/`ProjectDetail` 增加 `deletedAt: string | null`，新增 shared zod schema（`RestoreOutcomes` 无需 body，永久删除走空 body），frontend api client 增加 `del` 能力。
- 前端：项目列表页增加删除（Popconfirm 二次确认）、回收站入口/筛选 Tag、恢复与永久删除；侧栏项目计数排除回收站项目。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `novel-pipeline`：新增「项目软删除与回收站」需求（删除标记、回收站检索、恢复后产物与 stale 状态保持不变、项目的存在性与可见性语义），并扩充「生成中防并发与重复生成」覆盖到删除操作（运行时拒绝删除、后台残留任务不得写入已删除项目）。
- `novel-frontend`：修改「项目列表与创作入口」需求，增加回收站视图、删除/恢复/永久删除交互与不可撤销提示；计数类展示排除已删除项目。

## Impact

- 后端：`novel.controller.ts` 新增路由（注意 `projects/trash` 须声明在 `projects/:id` 之前）、`pipeline.service.ts` 新增 `softDelete/restore/purge/listTrash` 并给 `list/get/读写路径` 加过滤、`prisma/schema.prisma` 与新增 migration。
- 共享契约：`shared/src/index.ts`（`ProjectSummary`、`ProjectDetail`、相关请求 schema）。
- 前端：`api/client.ts`（新增 `del`）、`api/novel.ts`、`ProjectListPage.tsx`、`hooks/useProjectCount.ts`、路由/侧栏。
- 测试：`backend/src/novel/pipeline/*.spec.ts` 新增软删除用例；`backend/test/*.e2e-spec.ts` 的 `beforeAll` 清理需改为物理删除或带 `deletedAt` 过滤（避免测试遗留的已删除项目污染断言）；前端 `ProjectListPage.test.tsx` 补充回收站交互用例。
