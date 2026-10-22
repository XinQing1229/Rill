# Design

> 动机与范围见 `proposal.md`；行为契约见 `specs/novel-frontend/spec.md`。本文只记录实现层面的关键决策。

## Context

- 前端目前是脚手架：`App.tsx` 只有 Layout + `HealthCard`/`LlmPingCard`，无路由、无 novel 相关页面；`api/client.ts` 已有 `request<T>()` fetch 封装；组件仅 2 个。
- 后端 `novel.controller.ts` 已提供全部端点（问卷结构、项目创建/查询、生成/确认/回退/模式切换、人物与关系列表）；契约类型在 `@rill/shared`（`STAGES`、`PremiseSchema`、`worldSchemaFor(genre)`、`CharacterListSchema`、`RelationListSchema` 等）。
- 技术栈约束：Vite + React 19 + AntD 5 + TypeScript strict；测试 vitest + Testing Library；`npm test`/`npm run lint` 提交前必须通过。
- 生成是异步的：`POST generate` 立即返回，阶段进入 `generating`，后台推进；前端必须轮询 `GET /projects/:id` 才能看到落定结果。

## Goals / Non-Goals

**Goals:**

- 三个页面（列表、问卷向导、工作台）+ API 层 +  hooks，覆盖种子/世界观/人物三阶段的完整前端链路
- 一套落地的视觉规范（token → AntD theme 映射），遵循桌面 Web 工作台的设计规则：扁平表面、色彩只上数据与状态、近黑主按钮、诚实的空/加载/错误状态
- 轮询、防重（409）、阻塞（上游未就绪）、stale 展示都有明确的前端行为

**Non-Goals:**

- 不做大纲/细纲/正文阶段的界面（后续 change）
- 不做项目编辑/删除、多人协作、账号体系
- 不引入后端能力、不改 `shared/` 契约
- 不做前端 e2e（playwright/cypress）——以组件测试 + 手动验证为主

## Decisions

### 1. 路由用 `react-router-dom`

三个页面 + 未来阶段扩展需要真实路由。备选：自造 hash 路由——页面少但可维护性差，且浏览器前进/后退、深链接都要自己处理。选 `react-router-dom`（当前主线版本），`BrowserRouter` 挂在 `main.tsx`，dev server 已有 history fallback。

### 2. 数据层用自定义 hooks，不引 TanStack Query

本前端只有一种核心资源（project detail）+ 一个静态结构（questionnaire）。轮询条件简单：`project.status === 'running'` 或当前阶段 `generating` 时轮询，落定即停。用 `useProject(id)`（`useEffect` + interval，落定/卸载即清）+ `useQuestionnaire(genre)` 足够。备选 TanStack Query：能力更强但引入较重依赖与 Provider 改造成本，当前规模不划算。若后续阶段变体（大纲/细纲）让资源种类变多，再迁移不迟——hooks 内部封装了 `request`，迁移面小。

### 3. 生成后轮询，不用 `wait` 参数

后端 `generate` 支持 `{ wait }` 同步等待，但生成可能数十秒，会挂起 HTTP 连接且中间无取消手段。前端统一走「触发 → 立即返回 → 轮询 `GET /projects/:id`（1.5s 间隔）→ 阶段 done/failed 即停」。轮询只读详情端点，无副作用，天然防重。

### 4. 组件分层与产物分派

```
pages/          页面级组件（路由入口）
components/
  pipeline/     时间轴、阶段面板、状态徽标
  premise|world|characters/  产物展示
  questionnaire/ 动态问卷表单
hooks/          useProject（轮询）、useQuestionnaire
api/novel.ts    端点封装，类型全来自 @rill/shared
```

世界观的类型自定义块（`powerSystem`/`techTree`/`institutions`/`mysteryRules`/`industry`/`relationSetting`）用一张 `genre → 渲染组件` 的注册表分派，新增类型只加一项，与后端 `worldSchemaFor(genre)` 的工厂函数对称。人物、关系直接按 `CharacterListSchema`/`RelationListSchema` 渲染。

### 5. 视觉规范：桌面 Web 工作台规则落地为 token

遵循桌面 Web 产品界面的设计规则（对 23 个真实产品工作台界面的研究结论），以 CSS 变量定义 token，再映射到 AntD `ConfigProvider` theme，确保 AntD 组件（Button/Table/Tag/Skeleton…）不吃默认蓝：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--ground` | `#f9fafb` | 页面底色 |
| `--surface` | `#ffffff` | 卡片/面板 |
| `--border` | `#e8e8e8` | 卡片 1px 边框（不用阴影） |
| `--rule` | `#f2f2f2` | 表格行线 |
| `--control` | `#d1d5db` | 输入框边框 |
| `--text` / `--muted` / `--faint` | `#111` / `#5f6368` / `#6b6b6b` | 三级文字（全部 ≥4.5:1） |
| `--primary` | `#1d1f20` | 主按钮近黑填充、白字 |
| `--accent` | `#8a5a2b`（书墨棕） | 只上数据：当前阶段标记、进度、图表类元素 |
| `--positive` / `--negative` | `#247b50` / `#c4242a` | 状态文字；pill 用浅底深字对 |
| 圆角 | 卡片 8 / 控件 6 / chip 4 | 一套，不混 |
| 字号 | 24 标题 / 16 区块 / 14 正文 / 12 辅助 | 四级，tabular-nums 上数字 |

关键规则：**色彩只上数据、状态和唯一主操作**；阶段状态用浅底深字 pill（done=绿对、failed=红对、generating=灰、stale= warning 对）；不用渐变、不用图标彩色圆底、不用 hero 大标题（页面标题 24px 名词）。签名元素是**阶段时间轴本身**——小说一阶段一阶段长出来，就是这个产品独有的视觉主体；产品标识用文字 mark「Rill」+ 一个小刻度符号，不画黑底字母块。

### 6. 问卷向导的级联处理

类型是第一问：选定后请求 `GET /novel/questionnaire?genre=` 渲染其余问题。切换类型时保留必答 4 项已填值、清空上一类型的 `extras.*` 级联项（它们属于上一个类型的定义）。提交前用 `REQUIRED_ANSWER_FIELDS` 本地校验；400 回来时把缺失字段名回填到表单项报错。

### 7. 工作台信息架构

- **标题行**：`h1` = 项目标题（24px），右侧 = 模式切换（manual/auto 分段控件）+ 新鲜度时间戳；下方一行灰色副题 = 问卷已选维度只读展示（类型 · 篇幅 · 基调 · 视角）。
- **左侧阶段时间轴**（约 220px，桌面固定侧栏）：按项目阶段列表渲染，状态徽标 + 当前阶段用 `--accent` 3px 左缘标记；点击已完成阶段回看产物。
- 右侧当前阶段面板：按状态分流——等待中（生成按钮 + 上游阻塞提示）/ 生成中（骨架屏，保持最终布局，无 shimmer）/ 已完成（产物 + 确认推进或重新生成）/ 失败（错误句 + 重试）/ stale（失效标记 + 重新生成）。
- 响应式：只做桌面 Web（1440/1280 为验收视口）。不实现手机布局、折叠导航与触屏适配；布局随窗口流体收缩，但窄窗口表现明确不在验收范围内。

### 8. 状态语义与后端对齐

上游聚合状态以 `UpstreamAssembler.readStageState` 的口径为准（1:N 产物任一 stale 即视为失效）。前端不自己推导 stale，只消费后端返回的状态；轮询间隔 1.5s，落定即停，组件卸载清定时器。

## Risks / Trade-offs

- **轮询频率与后端压力** → 1.5s 只读轮询、仅 `running` 时启用；若后续用户量上来，换 SSE/WebSocket 或 `wait` 长轮询，`useProject` 内部可替换而不动页面。
- **AntD 默认主题渗透** → token 必须经 `ConfigProvider` 完整映射（colorPrimary、colorBorder、colorText、fontSize 等），并在组件测试中断言关键类名不被默认蓝污染；另在 `index.css` 用 CSS 变量兜底非 AntD 自绘部分。
- **类型自定义块注册表漂移** → 渲染注册表与 `shared` 的 `CUSTOM_WORLD_SCHEMAS` 键集合保持一致；加一个 shared 不认识的 genre 键时降级为只展示通用骨架 + 一行提示，不白屏。
- **1:N 阶段状态展示**（characters/relations）→ 完全按后端聚合结果展示，前端不推断；测试用 fixture 固定「任一 stale」用例。
- **表单草稿丢失** → 向导刷新丢状态可接受（创建项目本应一次完成）；记录为已知限制，不引 localStorage。

## Migration Plan

纯新增：新页面/组件/hooks/api 文件 + `App.tsx` 挂路由 + `frontend/package.json` 加 `react-router-dom`。无数据迁移、无后端改动；回滚 = 撤销前端新增文件与依赖。

## Open Questions

- 项目列表是否需要搜索/排序：当前阶段不做（项目数量预期为个位数），列表页留出标题栏右侧空间，后续加。
- 问卷向导草稿本地保存：不做，见 Risks。
- 关系网是否随人物阶段一起展示：是（spec 已定），作为人物面板的附属区块，不占独立阶段入口。
