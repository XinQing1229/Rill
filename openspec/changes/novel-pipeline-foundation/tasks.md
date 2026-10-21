# Tasks

## 1. 持久化基础设施

- [x] 1.1 安装 `prisma` 与 `@prisma/client` 到后端工作区（使用镜像源） — verify: `npm ls` 能看到两个包
- [x] 1.2 初始化 `backend/prisma/schema.prisma`（SQLite provider，`DATABASE_URL=file:./dev.db`）— verify: `prisma validate` 通过
- [x] 1.3 实现 `PrismaService`：`onModuleInit` 连接、`onModuleDestroy` 断开 — verify: 服务启动日志无连接错误，关闭时无泄漏
- [x] 1.4 将 `*.db` 加入 `.gitignore`，`.env.example` 增加 `DATABASE_URL` — verify: 创建 dev.db 后 `git status` 不显示该文件
- [x] 1.5 后端 `build` 脚本纳入 `prisma generate` — verify: 删除 node_modules/.prisma 后重新 build 能成功生成客户端

## 2. 数据模型

- [x] 2.1 定义 `Project` 表：id、title、genre、length、mode、currentStage、status、token 统计 — verify: 迁移成功且能创建/查询项目
- [x] 2.2 定义 `Premise` 表（项目 1:1）：结构化字段 + JSON 扩展 + status + stale + token 用量 — verify: 迁移成功且能随项目读写
- [x] 2.3 生成并应用首次迁移 — verify: `prisma migrate dev` 成功，dev.db 中含两张表

## 3. 类型配置

- [x] 3.1 定义 genre profile：类型枚举、世界观阶段是否跳过及详略权重、建议章节字数、类型特征变量 — verify: 单测验证每种类型都能取到完整配置
- [x] 3.2 实现「类型 + 篇幅 → 阶段列表」计算，支持跳过声明的阶段 — verify: 单测验证声明跳过的类型其阶段列表不含该阶段
- [x] 3.3 阶段列表覆盖完整创作流程（种子→世界观→人物→大纲→细纲→正文）占位 — verify: 单测验证短篇默认阶段顺序正确
- [x] 3.4 在 `@rill/shared` 定义问卷结构与选项枚举（必答 4 项：类型/篇幅/基调/视角；类型级联选答；版本号）— verify: 前后端均可 import 且 `tsc` 无错误
- [x] 3.5 实现问卷解析与校验：必答项缺失时拒绝生成并列出缺失项 — verify: 单测断言缺失任一项即报错且返回缺失项名称
- [x] 3.6 实现类型级联：问卷随所选类型给出该类型特有选答项 — verify: 单测断言玄幻含金手指项、悬疑不含该项

## 4. 流水线状态机

- [x] 4.1 定义阶段与产物状态枚举（pending/generating/done/failed + stale）— verify: 类型定义可被前后端共享引用
- [x] 4.2 实现 `PipelineService`：创建项目、触发生成、确认推进、回退、模式切换 — verify: 单测覆盖四条主路径
- [x] 4.3 并发与重复生成防护：generating 拒绝新请求，done 阶段需显式重新生成 — verify: 单测断言 generating 时不发起新的模型调用
- [x] 4.4 自动模式连续推进，失败停在该阶段并标记 failed，再次启动从失败阶段继续 — verify: 单测模拟中途失败，断言已完成阶段不重复生成
- [x] 4.5 回退后下游产物标记为 stale，失效产物不得被直接使用 — verify: 单测断言回退后下游 stale=true 且读取时被拒绝

## 5. 种子（Premise）生成

- [x] 5.1 在 `@rill/shared` 定义 `PremiseSchema` 与流水线契约类型（**不含用户已选维度**：基调、视角、类型、篇幅由问卷决定）— verify: 前后端均可 import 且 `tsc` 无错误
- [x] 5.2 新增种子阶段提示词模板，问卷答案与类型特征作为变量注入（不按类型建模板）— verify: 单测验证不同类型渲染出的内容含对应类型特征
- [x] 5.3 实现 `PremiseGenerator`：接收问卷答案 → 走 `completeStructured` + schema 校验 + 写库 + 记录 token 用量 — verify: 单测 mock 生成结果，断言产物入库、用量被记录，且产物中基调/视角与用户所选一致
- [x] 5.4 生成失败时不写入产物并将阶段标记为 failed — verify: 单测 mock 生成失败，断言库中无产物且状态为 failed

## 6. API 端点

- [x] 6.1 项目接口：创建（指定类型/篇幅/模式）与查询 — verify: e2e 测试断言创建后可按 id 查回
- [x] 6.2 流水线接口：触发生成、确认、回退、切换模式 — verify: e2e 测试断言「生成→确认→进入下一阶段」链路
- [x] 6.3 生成接口立即返回（阶段进入 generating），不阻塞等待模型 — verify: e2e 测试断言接口返回时阶段为 generating 或已完成，而非同步等待

## 7. 验收与收尾

- [x] 7.1 真实调用验收：创建项目 → 生成种子 → 确认 → 推进到下一阶段，全链路走通 — verify: 实际调用生成出结构化种子，数据库中有产物与用量记录
- [x] 7.2 服务重启后项目与待确认状态仍可恢复 — verify: 重启进程后查询项目，阶段与产物不变
- [x] 7.3 全量测试、lint 与格式检查 — verify: `npm test`、`npm run lint`、`npm run format:check` 全部通过
- [x] 7.4 以 conventional commit 提交本次变更 — verify: `git log` 显示提交且不含 `.env` 与 `*.db`
