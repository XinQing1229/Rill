# Proposal

## Why

后端流水线已经能产出种子、世界观、人物（含关系网），但前端只有一个健康检查页——作者填不了问卷、看不到任何产物、无法确认/回退/切换推进模式，创作链路整段断在前端。工作台是作者每次创作都要待上数小时的界面，它的信息架构与状态设计直接决定这条流水线好不好用，因此 UI/UX 与功能在本 change 内一并落地。

## What Changes

- 前端新增路由与三个页面：项目列表页、问卷向导页、创作工作台页（核心）
- 新增 API 层：封装 `novel` 相关端点（问卷结构、项目 CRUD、生成/确认/回退/模式切换、人物与关系查询），类型全部来自 `@rill/shared`
- 问卷向导：类型选择 → 按 `GET /novel/questionnaire?genre=` 动态渲染级联问卷；`extras.*` 选答归入 `answers.extras`；提交前本地预校验必答 4 项
- 创作工作台：
  - 阶段时间轴按 `stagesFor(genre)` 渲染（都市/言情自动跳过 world），每阶段带状态徽标（pending/generating/done/failed/stale）
  - 当前阶段产物展示：种子（premise）、世界观（通用骨架 + 类型自定义块）、人物卡（主角置顶）与关系网附表
  - 阶段操作：生成、确认并推进（manual）、重新生成（force，二次确认）、回退（下游标记 stale）、manual/auto 模式切换
  - 生成中轮询项目详情直到阶段落定；409（生成中）与 400（缺失问卷项）有明确反馈
- UI/UX 按桌面 Web 工作台的设计规则落地：扁平表面（1px 边框或色阶分隔，无阴影）、色彩只上数据与状态、近黑主按钮、诚实的空/加载/错误状态、桌面优先的响应式（窄窗口不破坏）
- 组件测试：问卷表单校验与 `extras` 组装、阶段时间轴各状态渲染、三个产物组件的 fixture 渲染

## Capabilities

### New Capabilities

- `novel-frontend`: 小说创作前端——从问卷到工作台的完整链路。问卷先行且级联；工作台按阶段呈现产物并暴露生成/确认/回退/重新生成/模式切换操作；生成中轮询、防重反馈、stale 展示；产物严格按 shared schema 结构渲染，问卷已选维度只读展示

### Modified Capabilities

（无——本 change 只新增前端能力，不修改任何既有规范的 requirement：`novel-pipeline` 的阶段流程、确认推进、回退失效等行为由后端实现，前端只消费既有 API，契约不变）

## Impact

- `frontend/` 新增 `api/novel.ts`、`pages/`（列表/向导/工作台）、`components/`（pipeline/premise/world/characters/questionnaire）、`hooks/`（useProject 轮询、useQuestionnaire）
- 新增前端依赖：`react-router-dom`（路由）；数据请求与轮询方案在 design.md 中选定（自定义 hook 或 TanStack Query）
- 无 `shared/`、`backend/` 改动；不新增 API
- 工作台 UI 的视觉规范（token、布局、状态）以 design.md 为准，实现时映射到 AntD 5 的 `ConfigProvider` theme
