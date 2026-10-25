# Rill

novel make agent —— 一个写小说并上传到小说平台的 Agent。

当前状态：已实现结构化问卷、种子、世界观、人物与关系，以及两步确认的大纲生成。支持手动/自动推进、持久化恢复、回退与下游失效。正文已支持逐章生成、审核、摘要和人工接受，小说平台上传尚未实现。

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
| `npm run dev` | 一条命令启动 shared 持续编译与前后端 dev server |
| `npm run build` | 按 shared → backend → frontend 顺序构建 |
| `npm test` | 运行所有工作区的测试 |
| `npm run lint` | 运行所有工作区的 lint |
| `npm run format` | 用 Prettier 格式化全仓库 |
| `npm run format:check` | 检查格式（不写入） |

单个工作区：`npm run test -w @rill/backend`、`npm run dev -w @rill/frontend` 等。

SQLite 原生驱动通过根目录 `overrides` 统一锁定为 `better-sqlite3 13.0.3`（N-API 版本），避免旧驱动在 Node 24 垃圾回收时触发原生断言、导致后端退出。更新依赖后需停止旧服务，运行 `npm install` 并重新启动。`npm run test:sqlite -w @rill/backend` 可单独检查原生异步回调中的 Statement 回收和数据库持久化；后端测试默认包含此检查，使用临时数据库。

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
2. 在大纲工作台设置目标章数；当前仅支持短篇，默认 4 章。
3. 生成全书规划，直接编辑主线、转折、结局、人物发展与分段，保存后点击「确认规划并展开章纲」。保存不会自动确认。
4. 系统按剧情段顺序展开章纲，每批最多 10 章。失败时点击续跑，已完成批次和保存的人工编辑会保留。
5. 按需选择章节编辑概要，保存后点击「确认完整大纲并进入正文」。确认后直接开始第一章正文生成。

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

### 正文：按建议修改、AI 审核与逐章接受

确认完整大纲后直接进入正文，不再生成或确认节拍。默认书籍目录为仓库根目录下的 `output/{projectId}/`，与书名及启动工作目录无关；`PROSE_OUTPUT_DIR` 可指定绝对输出根目录。

- `chapters/001.md`：UTF-8 正文，草稿和接受后使用同一路径，由应用管理修改。
- `drafts/`：首次生成的内部落盘记录。旧 `candidates/` 保留归档，页面不再提供候选稿或本地合并入口。
- `book.md`、`summaries/`、`reviews/`：应用生成的可重建目录、摘要、审核投影，不作为手工编辑入口。

每章依次执行正文生成、AI 七维审核、待接受摘要、人工接受。审核只含 warning 或无问题才自动生成摘要；error/critical 分别要求润色/重写，作者也可填写理由保留原判并继续生成摘要。摘要尚未人工接受时不参与后文生成。自动模式也在正文阶段逐章等待人工接受。

审核 v2 使用多段精确引用：`evidence` 为本章原文片段数组，`previousEvidence.quotes` 为指定前文章节的已接受摘要片段数组。每个片段独立逐字核验，不忽略空白或标点；跨段论证拆成多个片段，不得自行用省略号拼接。原文本身已有的省略号可原样引用。错误会标明问题和片段下标，失败报告保留原始数组。旧有效报告的单字符串仅在读取时兼容为单元素数组，历史记录和文件保持原样。

在「按建议修改」中逐条勾选 AI 审核建议（默认不选，支持全选、清空），或填写自己的修改要求。生成预览后先查看实际差异与修改后全文，点击「应用修改并重新审核」直接更新正式正文。未选建议不作为本次修改要求，重新审核仍检查全部正文。应用后，本章及后文旧审核、摘要与接受失效；后文保留原文并按顺序复核。审核/摘要失败可以独立重试，保留已应用正文。第一章不需要前文摘要。

失败审核诊断保存到 SQLite 的 `ProseReview.data`，并写入 `reviews/{章号}-{审核ID}-failed.json`。其中包含失败原因、已返回的审核结果 `output`、正文哈希及依赖版本；证据校验错误会注明具体问题字段。`output: null` 表示业务层未取得模型结果，无法还原供应商原始响应。重试保留此前诊断，失败记录不能用于摘要生成或人工接受；文件写入失败时数据库仍保留诊断并提示。此功能对后续审核生效，此前已丢弃的失败输出无法补回。

正文 API 位于 `/api/novel/projects/:id/prose`，章节操作为 `/chapters/:number/{retry,override,confirm}`。`POST /chapters/:number/revisions` 创建修改任务（202）；读取 `/revisions/:revisionId` 跟踪状态，`/apply` 应用修改，`/discard` 放弃预览。文件异常且有可信快照时，`POST /chapters/:number/restore` 恢复已保存正文。旧 `/regenerate` 返回 410。`retry` 恢复缺失的审核或摘要；`confirm` 携带当前版本、哈希、审核和摘要 ID；`override` 还需非空理由，不能覆盖执行失败的审核报告。

备份时同时保存 SQLite 数据库、checkpoint 与完整 `output/`；只备份数据库无法恢复正文。软删除保留目录，恢复时检查本地改动；永久删除清理该项目目录，失败可重试。输出文件已被 git 忽略。

### 导出书本与逐章复制

工作台在正文后提供独立的「导出书本」入口；正文全部有效接受即代表创作完成，导出不会改变创作阶段，也不调用模型。全书完成前也可以编辑成书信息、预览已有章节并复制已接受且依赖有效的章节。

- 书名、作者、简介与项目名称独立保存，书名必填。章名默认来自大纲，可设置展示标题；大纲版本变化后需重新核对覆盖标题。
- 复制支持「带标题纯文本」「仅正文」「Markdown 原文」，记住同一浏览器的选择；每次均核验当前本地正文和接受证据。Markdown 原文保留源标题，剪贴板不可用时可手动选中复制。
- 保存信息并预览后，可多选 TXT、Markdown、EPUB。三者使用同一快照，结构为书籍信息、可选简介、目录及有序章节。标题明确匹配才去重，疑似重复会指出章节；请通过按建议修改处理后重新审核接受。
- 首版支持文字段落、标题、强调、分隔线与安全链接；图片、表格、列表、代码块及原始 HTML 等结构会定位并阻止转换，不执行脚本或加载远程资源。原文复制仍可使用。
- 任务在后台执行，离开后可以返回查看。单格式失败可独立重试，历史文件始终对应原快照；正文或书籍信息更新后旧文件标记为历史版本。历史文件丢失时可基于完整原快照恢复。
- 首版为单后端实例、SQLite 持久化任务。重启后完整快照上的未完成格式自动恢复；准备快照时中断需重新导出。旧转换规则不兼容时明确失败，不用最新正文替换快照。
- 文件存于 `output/{projectId}/exports/{jobId}/`（根目录遵循 `PROSE_OUTPUT_DIR`）。历史不自动清理；手动删除记录会删除所属快照及文件，正文不受影响。项目软删除保留文件、暂停任务并拒绝访问；永久删除统一清理，失败可重试。
- API 前缀为 `/api/novel/projects/:id/book-export`，包含 `settings`、`preview`、`chapters/:number/copy`、`jobs`、`jobs/:jobId/retry` 与 `jobs/:jobId/files/:format`。备份须包含 SQLite、checkpoint 与完整 output；仅备份数据库不能恢复正文和导出文件。

已有环境升级后，在 backend 工作区执行 `npx prisma migrate deploy` 应用新增表，再重启后端；开发数据库不会由页面或构建过程自动迁移。

### 开发启动顺序

`npm run dev` 会先构建 shared，再并行启动 shared 持续编译、后端监听和前端开发服务；前端等待 `http://localhost:3000/api/health` 返回就绪后启动，并自动打开浏览器。等待超过 120 秒会报告超时，请查看终端中的后端日志。

开发时保持该终端运行，不必每次改完代码重新执行命令：前端页面和组件保存后由 Vite 热更新；后端源码保存后由 Nest 自动编译、重启；`shared/src` 保存后自动重新编译，并触发后端加载新契约，前端同步更新。首次切换到这套启动配置时，先停止旧进程，再执行一次 `npm run dev`。

修改依赖、开发启动脚本或环境配置时，仍可能需要安装依赖或重启；Prisma 数据库结构变化需执行对应迁移，源码监听不会自动修改数据库。后端重启会中断正在进行的生成任务，待服务恢复后可从已保存进度续跑。

### Web API Key 设置

在侧栏打开「API Key 设置」，可保存、更换或清除 DeepSeek API Key。设置对同一后端的所有创作任务生效；接口地址和模型继续使用后端环境配置。密钥原子写入已被 Git 忽略的 `backend/.env`，文件权限限制为当前用户读写，不保存在浏览器，也不通过查询接口回显。

保存成功后清空输入，后续模型调用立即使用新密钥；已经发出的请求继续使用调用时的密钥。保存不会调用 AI。清除后仍可查看已有小说，调用模型前需重新配置。可在「诊断」页面主动测试连接，测试会产生实际模型用量。运行环境显式注入的同名环境变量仍按原规则优先于 `.env` 在启动时读取。

接口为 `GET /api/llm/settings`（脱敏状态）与 `POST /api/llm/settings`（`{ action: "replace", apiKey }` 或 `{ action: "remove" }`）。这是当前单用户后端的服务级设置；服务部署到公网时，应通过部署层访问控制限制整个应用的访问。

当前创作范围仅支持短篇，创建问卷默认选择短篇；接口拒绝其他篇幅。历史项目与正文不会删除或自动改写篇幅，历史非短篇项目的已有产物仍可查看，但不能继续生成。


### 创作问卷与文风

新建项目必答三项：类型、篇幅、叙事视角。创作意图优先填写故事想法（选填，最多 2000 字符）；书名（选填，最多 100 字符）、人物数量及类型偏好位于「更多偏好」。未填书名时先显示「未命名作品」，正式种子生成后同步暂定书名，作者自填及旧项目书名不被覆盖。阅读体验、主角职业和言情关系预选已移除；旧项目对应答案保留。文风当前只有默认选中的「短篇爽文」，规则贯穿种子、大纲、正文与审核，遵守作者的故事设定和视角选择。人物关系仍正常生成。

文风随项目保存固定版本，创建后暂不可切换。历史项目不自动补文风，界面显示「未指定」，已有关系约束及正文继续保留。详细方案见 [短篇爽文设计](docs/short-satisfying-writing-style-design.md)。
