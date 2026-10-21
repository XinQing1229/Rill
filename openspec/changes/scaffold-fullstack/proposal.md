# Proposal

## Why

Rill 目前是一个空仓库（仅有 README），没有代码、构建体系或开发环境。在开发「小说创作 agent」（创意 -> 大纲 -> 章节 -> 上传平台）之前，需要一个可运行的全栈脚手架：统一的技术栈基线、一键启动的开发环境、以及经过真实调用验证的 LLM 接入通道。否则每个后续功能都要重复解决环境问题，LLM 密钥与连通性也会成为不可控的隐藏风险。

## What Changes

- 建立 npm workspaces monorepo：`backend/`（NestJS）、`frontend/`（Vite + React + TypeScript + Ant Design）、`shared/`（前后端共享的 API 契约类型）
- 后端提供 `GET /api/health` 健康检查端点
- 后端提供 `POST /api/llm/ping`：使用环境变量中的 DeepSeek 配置向 LLM 发起一次真实调用并返回结果
- LLM 客户端基于 OpenAI 兼容 SDK，`base_url` 指向 `https://api.deepseek.com`，默认模型 `deepseek-flash`，可切换 `deepseek-v4-pro`
- 前端为 Ant Design Layout 外壳 + 演示页面（调用 health 与 llm/ping）
- 工程规范基线：Prettier + ESLint、后端 Jest / 前端 Vitest、`.nvmrc` 锁定 Node 24、conventional commits
- 明确不在本次范围：数据库、部署、SSE 流式端到端（llm 客户端预留 stream 方法签名，真实流式留给后续 change）

## Capabilities

### New Capabilities

- `dev-environment`: 一键启动的全栈本地开发环境，包括前后端 dev server、健康检查端点、经真实调用验证的 LLM 连通性，以及密钥的安全管理（key 只进 gitignore 的 `.env`）

### Modified Capabilities

（无——仓库为空，不存在需要修改的既有能力）

## Impact

- 新增整个仓库代码结构（`backend/`、`frontend/`、`shared/` 三个 workspace）
- 新增依赖：后端 `@nestjs/*`、`openai`、`@nestjs/config`；前端 `react`、`vite`、`antd`、`@ant-design/icons` 等
- 新增 `.env`（加入 `.gitignore`）与 `.env.example` 环境配置模板
- 开发者本地需准备 Node 24 与有效的 DeepSeek API key
- 无破坏性变更（仓库此前无代码）
