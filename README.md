# Rill

novel make agent —— 一个写小说并上传到小说平台的 Agent。

当前状态：已实现结构化问卷、种子、世界观、人物与关系，以及两步确认的大纲生成。支持手动/自动推进、持久化恢复、回退与下游失效。细纲、正文与小说平台上传仍待后续 OpenSpec 变更实现。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vite + React + TypeScript + Ant Design 5 |
| 后端 | NestJS + TypeScript |
| 共享 | `@rill/shared`（前后端共享的 API 契约类型） |
| 组织方式 | npm workspaces monorepo |
| LLM | DeepSeek（`https://api.deepseek.com`，OpenAI 兼容协议） |

## 目录结构

```
rill/
├── backend/     # NestJS 后端（默认端口 3000，全局前缀 /api）
├── frontend/    # Vite + React 前端（默认端口 5173，/api 代理到后端）
├── shared/      # 前后端共享的 API 契约类型
└── openspec/    # OpenSpec 变更与能力规范
```

## 环境要求

- Node 24（仓库含 `.nvmrc`，可用 `nvm use` 切换）
- npm 11+（Node 自带）
- 一个有效的 DeepSeek API Key

## 快速开始

```bash
# 1. 安装依赖（monorepo 全部工作区）
npm install

# 2. 配置后端环境变量
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入真实的 DEEPSEEK_API_KEY

# 3. 一条命令启动前后端
npm run dev
```

启动后：

- 前端：<http://localhost:5173>
- 后端：<http://localhost:3000/api/health>

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 一条命令启动前后端 dev server（先构建 shared） |
| `npm run build` | 按 shared → backend → frontend 顺序构建 |
| `npm test` | 运行所有工作区的测试 |
| `npm run lint` | 运行所有工作区的 lint |
| `npm run format` | 用 Prettier 格式化全仓库 |
| `npm run format:check` | 检查格式（不写入） |

单个工作区：`npm run test -w @rill/backend`、`npm run dev -w @rill/frontend` 等。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查，返回服务状态与时间戳 |
| POST | `/api/llm/ping` | 用当前配置向 DeepSeek 发起一次真实补全调用，验证连通性 |

## 环境变量

在 `backend/.env` 中配置（该文件已被 git 忽略，只提交 `.env.example`）：

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | — | DeepSeek API 密钥 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | 接口地址 |
| `LLM_DRAFT_MODEL` | 否 | `deepseek-flash` | 普通与结构化生成模型 |
| `LLM_REASONING_MODEL` | 否 | `deepseek-flash` | 推理用途模型 |
| `OUTLINE_CALL_TIMEOUT_MS` | 否 | `120000` | 大纲单批调用超时（毫秒） |
| `OUTLINE_TOTAL_TIMEOUT_MS` | 否 | `480000` | 一次章纲展开的总预算，耗尽后可续跑 |
| `OUTLINE_MAX_TOKENS` | 否 | `8192` | 大纲单次最大输出 token |
| `PORT` | 否 | `3000` | 后端端口 |

> 安全提示：API Key 只写入被 git 忽略的 `.env`，切勿提交到仓库或写入日志。

## 大纲生成与编辑

升级已有环境后先执行 `npm exec -w @rill/backend -- prisma migrate deploy`，新增表不会覆盖原有小说。

1. 完成并确认种子、世界观（按类型可跳过）、人物与关系。
2. 在大纲工作台设置目标章数；默认短篇 8、中篇 40、长篇 200 章。
3. 生成全书规划，直接编辑主线、转折、结局、人物发展与分段，保存后点击「确认规划并展开章纲」。保存不会自动确认。
4. 系统按剧情段顺序展开章纲，每批最多 10 章。失败时点击续跑，已完成批次和保存的人工编辑会保留。
5. 按需选择章节编辑概要，保存后点击「确认完整大纲并进入细纲」。当前细纲生成器尚未实现，确认事实会保留，流程在细纲阶段提示未开放。

修改规划或目标章数会使已有章纲及下游失效；修改单章概要保留其他章节，使完整大纲回到待确认、下游失效。已离开大纲阶段时需先回退后编辑。旧页面提交版本冲突时保留本地输入，可核对后载入最新内容。

自动模式在结构与业务校验通过后连续执行大纲内部步骤；错误停在对应步骤。两次人工确认通过 LangGraph 大纲子图暂停；业务内容、确认版本及批次进度独立持久化。服务重启后需要再次触发续跑，不会自行启动付费调用。模型已返回但尚未入库就宕机时，该批可能重新调用模型，不承诺外部请求绝对只调用一次。

大纲相关接口（前缀 `/api/novel/projects/:id`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/outline` | 大纲内容、版本与内部进度；未生成时只读返回默认配置 |
| PATCH | `/outline/config` | `expectedRevision`、`targetChapters` |
| PATCH | `/outline/plan` | `expectedRevision`、`plan` |
| PATCH | `/outline/chapters/:number` | `expectedRevision`、`chapter`；不改变章号或所属剧情段 |
| POST | `/confirm` | `target: outline-plan / outline` 与 `expectedRevision`，明确确认目标 |
| POST | `/generate` | 默认续跑；`force: true` 从规划重新生成 |

真实模型验收可在全仓构建后执行 `node backend/scripts/outline-smoke.mjs`。脚本使用隔离的临时数据库，生成 8 章并验证规划/章纲编辑确认，会产生实际模型用量；缺少密钥时明确跳过，输出不含密钥。

## 开发流程

本项目使用 OpenSpec 管理变更：

| 命令 | 说明 |
| --- | --- |
| `/opsx:propose` | 创建 change 并生成全部规划工件 |
| `/opsx:explore` | 动手前推敲问题 |
| `/opsx:apply <name>` | 按 tasks.md 实施变更 |
| `/opsx:archive <name>` | 归档已完成的 change |

提交信息遵循 conventional commits（`feat:` / `fix:` / `chore:` 等）。
