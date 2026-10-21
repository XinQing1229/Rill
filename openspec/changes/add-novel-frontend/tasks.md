# Tasks

## 1. 基础设置

- [ ] 1.1 安装 `react-router-dom`，并在 `main.tsx` 用 `BrowserRouter` 包裹 `App`；验证 `npm run build -w @rill/frontend` 通过
- [ ] 1.2 在 `index.css` 定义设计 token（ground/surface/border/rule/control/text/muted/faint/primary/accent/positive/negative、四级字号、圆角），并在 `App.tsx` 用 `ConfigProvider` 映射到 AntD theme（colorPrimary/colorBorder/colorText 等）；验证页面无默认蓝渗透（关键组件渲染后断言行内样式来自 token）
- [ ] 1.3 `App.tsx` 挂路由：`/` 项目列表、`/new` 问卷向导、`/projects/:id` 工作台；验证三条路由可导航且未知路径有兜底页

## 2. API 层与数据 hooks

- [ ] 2.1 新建 `api/novel.ts`：封装 questionnaire、项目创建/查询、generate、confirm、rollback、setMode、characters、relations 端点，类型全部从 `@rill/shared` 引入，复用 `client.ts` 的 `request`；验证 `tsc --noEmit` 无错误
- [ ] 2.2 实现 `useQuestionnaire(genre)`：按 genre 请求问卷结构，加载中/错误有状态；验证 hook 测试覆盖级联切换（换 genre 重新请求）
- [ ] 2.3 实现 `useProject(id)`：请求项目详情，`status === 'running'` 或当前阶段 generating 时以 1.5s 轮询，落定/卸载即停；验证测试用假定时器覆盖「轮询启动→落定→停止」「卸载清理」

## 3. 项目列表页

- [ ] 3.1 实现 `ProjectListPage`：卡片/行展示项目标题、类型、当前阶段、状态徽标、推进模式，点击进工作台，「新建项目」进向导；验证空状态有框架与一句话引导，加载用骨架保持布局

## 4. 问卷向导

- [ ] 4.1 实现 `NewProjectPage` 第一步：项目标题输入 + 类型选择；验证切换类型时保留必答已填值、清空上一类型 `extras.*` 级联项
- [ ] 4.2 实现问卷渲染：按 `useQuestionnaire` 动态生成表单项（必答 4 项 + characterScale + 类型级联项），`extras.` 前缀答案写入 `answers.extras`；验证测试覆盖 extras 组装与必答本地校验阻止提交
- [ ] 4.3 提交创建：调 `POST /novel/projects`，400 时将缺失项名称回填到表单项报错；验证成功后跳转 `/projects/:id`

## 5. 工作台骨架

- [ ] 5.1 实现标题行：`h1` 项目标题（24px）、右侧模式切换分段控件（manual/auto，调 setMode）、问卷已选维度只读副题行；验证模式切换后刷新页面保持
- [ ] 5.2 实现 `StageTimeline`：按项目阶段列表渲染（类型跳过 world 时不出现），状态徽标（pending/generating/done/failed/stale），当前阶段 accent 左缘标记，点击已完成阶段回看产物；验证测试覆盖「跳过的阶段不渲染」「各状态徽标渲染」
- [ ] 5.3 实现 `StagePanel` 状态分流：等待中（生成按钮 + 上游阻塞提示）、生成中（骨架屏）、已完成（产物 + 确认/重新生成）、失败（错误 + 重试）、stale（失效标记 + 重新生成）；验证各状态渲染测试
- [ ] 5.4 打通操作：generate（pending）、confirm（manual + done）、regenerate（force + 二次确认）、rollback（回退并展示下游 stale）；验证测试覆盖按钮禁用态（generating 时）与 409 提示「正在生成中」

## 6. 产物展示组件

- [ ] 6.1 实现 `PremiseView`：标题、梗概、主题、核心冲突、主角要素、设定、钩子、避雷标签；验证 fixture 渲染测试
- [ ] 6.2 实现 `WorldView`：概要、规则、势力 + `genre → 组件` 注册表分派类型自定义块（powerSystem/techTree/institutions/mysteryRules/industry/relationSetting），era/place 标注继承自种子；验证测试覆盖自定义块分派与未知 genre 降级（通用骨架 + 一行提示）
- [ ] 6.3 实现 `CharacterView`：人物卡片（name/role/identity/desire/flaw/personality/background/abilities/arc），主角置顶带标识；验证 fixture 渲染测试
- [ ] 6.4 实现 `RelationList`：表格展示从方、关系类型、到方、双方相对角色；无数据时展示空状态；验证测试覆盖空态与非空态

## 7. 响应式与收尾

- [ ] 7.1 响应式检查：1440px 与 1280px 桌面视口完整呈现，窗口缩窄至约 900px 时布局自适应（时间轴收窄或横滑、面板堆叠）、无横向滚动、主操作可达；验证手动检查 + 关键组件在窄容器渲染测试
- [ ] 7.2 全量 `npm test` 与 `npm run lint` 通过；验证命令输出无失败
- [ ] 7.3 手动联调：dev server 起前后端，走通「问卷创建 → 种子生成/确认 → 世界观生成/确认 → 人物生成/确认 → 回退看 stale → 重新生成」全流程；验证每步界面状态与 spec 场景一致
