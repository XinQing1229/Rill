# Rill

novel make agent —— 一个写小说并上传到小说平台的 Agent。

当前状态：全栈项目脚手架已就绪（本地开发环境、健康检查、LLM 连通性验证）。小说创作能力尚未实现，按 OpenSpec 变更流程逐个推进。

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
| `DEEPSEEK_MODEL` | 否 | `deepseek-flash` | 默认模型；重推理任务可用 `deepseek-v4-pro` |
| `PORT` | 否 | `3000` | 后端端口 |

> 安全提示：API Key 只写入被 git 忽略的 `.env`，切勿提交到仓库或写入日志。

## 开发流程

本项目使用 OpenSpec 管理变更：

| 命令 | 说明 |
| --- | --- |
| `/opsx:propose` | 创建 change 并生成全部规划工件 |
| `/opsx:explore` | 动手前推敲问题 |
| `/opsx:apply <name>` | 按 tasks.md 实施变更 |
| `/opsx:archive <name>` | 归档已完成的 change |

提交信息遵循 conventional commits（`feat:` / `fix:` / `chore:` 等）。
