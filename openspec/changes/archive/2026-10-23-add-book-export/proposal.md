# Proposal

## Why

正文逐章接受后，作者仍需手工拼接整书、整理标题并复制章节到小说平台。现有 `book.md` 只是可重建目录投影，不能作为完整交付文件；需要基于已接受版本提供可阅读、可交付的整书文件及可靠的逐章复制能力。

## What Changes

- 正文之后增加可随时进入的「导出书本」工作区，创作 Stage 与项目完成判定不变，手动及自动模式都由作者主动发起导出。
- 独立保存成书书名、作者、简介与章节展示标题；提供目录及章节预览。
- 有效且已接受的章节可立即复制，支持带标题纯文本、仅正文纯文本、Markdown 原文，记住上次选择。
- 全部章节有效接受后，可一次选择 TXT、Markdown、EPUB，从同一不可变快照生成整书。
- 后台任务持久化，支持各格式独立失败、重试、重启恢复、历史版本下载和手动删除。
- 导出前校验文件、接受证据、上游及前文依赖，识别预览过期和本地修改；不覆盖正文、不调用模型。
- 首版限定文字小说，不提供 PDF、Word、封面、分卷、插图、后记、项目备份或平台自动上传。

## Capabilities

### New Capabilities

- `book-export`：成书信息、有效章节复制、预览、固定快照、多格式生成、任务恢复、历史下载及生命周期。

### Modified Capabilities

- `novel-frontend`：增加正文之后的独立导出工作区、正文页复制入口、导出进度及阻塞反馈，不将导出当作创作阶段。

## Impact

- `shared/src/index.ts`：新增 zod API 契约、格式、复制模式、任务与文件状态；不扩展 `STAGES`。
- `backend/src/novel/book-export/`：新增模块、控制器、内容准备、快照、任务执行、转换及文件管理；复用并抽取正文接受有效性校验。
- `backend/src/novel/prose/`、`novel.module.ts` 与 `pipeline/pipeline.service.ts`：提供内容读取边界、依赖注入及项目删除协调。
- `backend/prisma/schema.prisma` 与迁移：新增成书配置、快照、导出任务与文件记录；SQLite 继续使用 String 与 JSON 字符串。
- 前端工作台、侧栏选择状态、正文操作、API 客户端：增加独立导出视图及二进制下载、剪贴板交互。
- 新增 Markdown AST 解析与 EPUB ZIP 打包依赖，实施时核验 Node 24 / ESM 兼容性；无需 Redis、额外 AI 服务或独立任务服务。
- 增加契约、后端单测及 HTTP e2e、前端组件测试、实际 EPUB 阅读验证；备份说明涵盖数据库及完整输出目录。
