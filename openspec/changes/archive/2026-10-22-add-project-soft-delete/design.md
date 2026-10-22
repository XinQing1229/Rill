# Design

## Context

当前 `Project` 有 6 张关联表且全部配置 `onDelete: Cascade`，任何物理删除都会连带抹掉种子、世界观、人物、关系、大纲、批次的产物与 `StageRun` 用量记录；无外键的 `OutlineUsage` 反而会留下孤儿行。pipeline 的所有业务入口都经由 `PipelineService.get(id)`（`prisma.project.findUnique`）读取项目，运行锁用 `Project.status='running' + runId` 的乐观锁（`acquireRun`），中断进度存在独立 SQLite 的 LangGraph checkpointer（`thread_id = projectId`）。

可见性改造因此有两个天然收窄点：`get()` / `list()` 是唯一入口，`updateMany` 乐观锁是唯一写入口。详见 proposal.md 的 Why 与 specs/novel-pipeline/spec.md 的需求条目。

## Goals / Non-Goals

**Goals:**

- 用一个可空删除标记让「删除 → 恢复」可逆，且默认读取路径（含列表、详情、人物/关系、生成/确认/回退/模式切换）一律排除已删除项目。
- 让删除不再触碰产物数据：软删除期间各阶段产物、`StageRun`、`stale` 标记、checkpoint 全部冻结。
- 让最终的物理清理也是彻底的：级联产物 + 无外键的用量记录 + 独立 checkpoint 都不留残余。
- 数据迁移向前兼容：既有行的删除标记默认为空（未删除），无需回填。

**Non-Goals:**

- 不做多用户 / 权限隔离，不做「按用户看自己的回收站」（尚无用户体系）。
- 不做回收站自动过期清理与容量上限（规范规定系统不自动物理清理）。
- 不做批量多选删除（仅提供整站「清空回收站」），不做项目导出/归档包。
- 不改动现有流水线推进语义与状态机取值。

## Decisions

### 1. 删除标记用 `Project.deletedAt DateTime?`，而不是扩展 `status` 枚举

`PROJECT_STATUSES`（`idle | running | done | failed`）描述的是流水线推进状态，被前端 `StatusTag`、KV 统计、graph 路由与 `onModuleInit` 的中断恢复复用；塞入 `deleted` 会让每个状态判断都要记得排除该分支，也让「删除前是 running 还是 failed」这一信息丢失。`deletedAt` 同时充当「是否删除」与「何时删除」（回收站展示删除时刻），正交信息互不污染。

> 备选：加 `Project.archived Boolean`。弃用，因为它承载不了删除时刻；回收站没有时间维度作者无法判断该永久清理哪些项目。

### 2. 单一可见性常量 + 收窄入口，不使用 Prisma 中间件

新增 `const VISIBLE: Prisma.ProjectWhereInput = { deletedAt: null }`，所有查询（含 `get`、`characters`、`relations` 等流水线读路径的 `findUnique`）统一套用，`get()` 在查不到或落入 `deletedAt != null` 时同样抛 `NotFoundException`（与现有一致，`backend/src/main.ts` 无全局过滤器，靠 NestJS 内建映射为 404）。

> 备选：Prisma `$extends` 的全局查询中间件。弃用——`onModuleInit` 的跨表 `updateMany` 与方言适配会让中间件出现例外 branch，反而比显式常量更容易漏；且 SQLite 无 RLS 可用。

### 3. 回收站读取走查询参数 `scope=trash`，不新增 `projects/trash` 路径

`GET /projects?scope=trash`、`DELETE /projects?scope=trash`（清空回收站）。`novel.controller.ts` 里 `projects/:id/outline` 等子路由目前写在 `projects/:id` 之后仍工作，但 `projects/trash` 会被 `projects/:id` 抢先匹配，属于顺序耦合的隐患；查询参数不存在这个问题，也让列表端点保持单一。

> 备选：`GET /projects/trash` 并靠声明顺序压制。弃用，依赖路由声明顺序的正确性是隐式契约。

API 终态：

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| `DELETE` | `/projects/:id` | 软删除，返回该项目摘要（含 `deletedAt`） |
| `POST` | `/projects/:id/restore` | 恢复，返回项目详情 |
| `DELETE` | `/projects/:id/permanent` | 永久删除单个回收站项目 |
| `DELETE` | `/projects?scope=trash` | 清空回收站 |
| `GET` | `/projects?scope=trash` | 回收站列表 |

### 4. 删除用乐观锁 `updateMany` 一次判定三种结果

```ts
const result = await this.prisma.project.updateMany({
  where: { id, deletedAt: null, status: { not: 'running' }, runId: null },
  data: { deletedAt: new Date() },
});
if (result.count !== 1) {
  const project = await this.prisma.project.findUnique({ where: { id } });
  if (!project) throw new NotFoundException(`项目不存在: ${id}`);        // 不存在或已删除
  throw new ConflictException('项目正在生成，请稍后删除');               // running
}
```

单次写保证「不存在 / 已删除 / 运行中」三种 HTTP 结果（404 / 404 / 409）判定无竞态，重复删除自然幂等落到 404。错误文案沿用现有风格（`NotFoundException(\`项目不存在: ${id}\`)`、`ConflictException('项目正在运行，请稍后回退')`）。

恢复同理：`updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null } })`，`count !== 1` 时 404。

### 5. 后置守卫保证删除期间的残留任务不写入产物

后台图可能横跨删除操作执行。采用双层：

- **写前校验**：`runGraph` 每个阶段节点执行前调用 `assertActive(id)`（一条 `project.count({ where: { id, deletedAt: null } })`），被删除时抛出哨兵错误，图执行被打断。
- **写后收敛**：`releaseRun` 只在项目仍可见时才写 `status/runId`；产物写入路径沿用 `updateMany` 带 `deletedAt: null` 条件，count 为 0 即静默丢弃。

这样「删除瞬间仍在跑」最多浪费一次模型调用，不会污染回收站中的项目。

> 备选：删除时强制 abort 正在运行的图。LangGraph 无可靠取消接口，且中途终止会让 `runId` 释放与资源清理失去保障；放弃 hack。

### 6. 永久删除必须补足级联之外的三种残余

`prisma.project.delete` 已能级联清理 StageRun / Premise / WorldSetting / Character / Relation / Outline / OutlineBatch，还需显式处理：

- `OutlineUsage`：**无外键**，必须 `deleteMany({ where: { projectId } })`；
- LangGraph checkpoint：存于独立 SQLite（`pipeline.checkpointFile`），走 `checkpointer.deleteThread(id)`；
- 以上 Prisma 部分用 `$transaction` 包裹，checkpoint 清理在事务成功后执行并记录日志（失败不回滚已删数据，仅告警）。

### 7. 前端沿用 Popconfirm，回收站作为列表页的一个视图而非独立路由

- `api/client.ts` 目前只有 `get/post/patch`，新增 `del<T>(path)`（`{ method: 'DELETE' }` + 复用现有 `ApiError` 分支）。
- 删除/恢复/永久删除用 `Popconfirm`（与 `components/pipeline/StagePanel.tsx` 现有惯例一致）；「清空回收站」是全局不可逆操作，用 `Modal.confirm` 并要求二次确认。
- 列表页用 `Segmented`（「创作中 / 回收站」）切换 `scope`，不新增路由；`useProjectCount` 仍读默认列表，天然排除回收站项目。
- 失败时直接展示后端 `message`（项目运行中 → 409 文案），列表不乐观更新，刷新即可。

### 8. 契约扩展与 migration

- `shared/src/index.ts`：`ProjectSummary`、`ProjectDetail` 增加 `deletedAt: string | null`（与既有 `createdAt/updatedAt` 同为 `string`）。
- `prisma/schema.prisma`：`deletedAt DateTime?` + `@@index([deletedAt])`（回收站列表与组合过滤）。
- migration 命名 `YYYYMMDDHHMMSS_project_soft_delete`，SQLite 走 Prisma RedefineTables 模板（与 `20261022053132_stage_run_stale/migration.sql` 一致）。可空列无需回填，旧程序读到 NULL 即未删除，属于向前兼容。

## Risks / Trade-offs

- **忘记套 `deletedAt: null` 的新查询导致回收站项目泄漏** →  mitigation：所有读路径收窄到 `get()`/常量 helper；jest 单测用「删除后对所有既有端点逐个断言 404」的表格化用例覆盖；e2e 的 `beforeAll` 改用物理 `project.deleteMany()` 清理，避免测试数据与断言互相污染。
- **恢复后作者看到的是删除瞬间的旧状态** → 这是规范要求的语义（回收站期间冻结），在 UI 用「恢复后可继续」文案避免误解。
- **永久删除不可逆** → 两级确认 + 仅在回收站视图内可达；默认路径不提供任何物理删除入口。
- **checkpoint 独立于 Prisma 事务** → 事务失败时可能留下孤儿 checkpoint；它不进入任何查询路径，仅占用 `checkpoints.db` 少量空间，记录 warn 日志即可。
- **`onModuleInit` 的重启清理会碰未删除项目** → 该 `updateMany` 需补 `deletedAt: null` 条件，否则会把运行中断的回收站项目一并改成 failed，破坏「回收站冻结」语义。

## Migration Plan

1. 写 migration 并执行 `npx prisma migrate dev`（SQLite 本地 `dev.db`，无生产数据迁移窗口）。
2. `prisma generate` 生成新 client（`build`/`dev` 脚本已内置）。
3. 后端：schema → service → controller 顺序落地，路由只做新增。
4. 契约先行：`shared` 改完再改前后端。
5. 前端最后接线（依赖后端端点与 `del` 能力）。
6. 回滚：回滚相应提交即可；该可空列保留亦无害，若确必须回退字段则按 RedefineTables 反向迁移。

## Open Questions

- 回收站中删除超过 N 天的项目是否弱化展示（如灰显、提示即将清理）：属于纯展示策略，可留到 UI 打磨阶段决定，不影响本 change 的需求与任务拆分。
