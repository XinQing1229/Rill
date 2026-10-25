# Design

## Context

动机见 proposal.md。`StageContext` 已能提供确认后的大纲和节拍，`ArtifactRegistry` 提供阶段存储与生成器登记，项目 runId 与 `commitGeneration` 隔离旧运行。正文尚未实现。当前通用 runner 将生成成功视为阶段 done，图的最后阶段没有手动中断；两者都不足以表达逐章待确认。大纲已有内部子图，可沿用其编排方式。

SQLite 与文件系统无法共同提交事务；外部编辑器不参与应用锁。设计必须区分正文内容、作者确认、摘要和执行进度。节拍变更当前调用阶段级 `setStale('prose')`，需要新增章节依赖入口。

`story-beats` 已同步到主规范，其规范要求其他章节正文保持有效。本次明确调整为此前正文有效、其后正文需复核，仅在本变更 delta 中修订。

## Goals / Non-Goals

**Goals:** 文件权威、作者内容可恢复、确认精确绑定内容、按章恢复、前文变化可追踪，复用现有运行互斥及 AI 基建。

**Non-Goals:** 首版不做平台上传、流式逐 token 展示、富文本编辑、任意目录导入、文件重命名跟踪、多机同步、自动返工或独立时间线。候选稿用于保护数据，不承诺完整历史版本产品。

## Decisions

### 1. 文件为正文权威，SQLite 为元数据和摘要权威

采用固定应用管理根目录：仓库根下 `output/{projectId}/`。使用配置模块解析稳定根路径，不随 backend 进程 cwd 改变；启动时验证可写。正文目录加入 git 忽略；仅允许服务端项目 ID 和合法章号推导路径，拒绝路径参数及符号链接越界。

```text
output/{projectId}/
  book.md
  chapters/001.md
  summaries/001.json
  reviews/{chapter}-{reviewId}.json
  candidates/{chapter}-{operationId}.md
```

正文以 UTF-8、标题和段落保存。章号至少补齐三位，不以标题命名。`book.md` 和摘要 JSON 是可重建投影，应用可以重建；界面和 README 明确这些文件不是手工编辑入口。上游资料暂不投影。

备选：数据库权威加导出无法自然接收外部修改；全文件存储则须重新实现运行互斥和状态查询。因此只把正文内容迁到文件。

### 2. 数据模型分离生成、确认和摘要

建议增加以下表，全部 String 枚举及校验后的 JSON 字符串，符合现有 Prisma 约定：

| 表 | 关键字段 |
| --- | --- |
| ProseBook | projectId 唯一、targetChapters、revision、completedRevision、stale |
| ProseChapter | bookId + chapterNumber 唯一、relativePath、generationStatus、reviewStatus、fileStatus、revision、observedHash、confirmedHash、outlineRevision、beatChapterRevision、prefixFingerprint、error |
| ProseReview | reviewId、chapterId、sourceHash、dependencyFingerprint、promptVersion、status、verdict、scores、issues、overrideReason、overrideAuthorizedAt、error |
| ProseAcceptance | acceptanceId、chapterId、reviewId、summaryId、sourceHash、dependencyFingerprint、overrideReason、acceptedAt |
| ProseSummary | summaryId、chapterId、sourceHash、prefixFingerprint、reviewId、data、status、acceptedAt、error |
| ProseOperation | operationId、projectId、runId、kind、chapterNumber、baseHash、resultHash、dependencyFingerprint、candidatePath、phase、error |
| ProseUsage | traceId 唯一、projectId、chapterNumber、purpose、输入输出用量 |

reviewStatus 使用 pending / confirmed / needs_review；generationStatus 沿用 pending / generating / done / failed；文件错误独立记录，避免把正文存在等同于已完成。摘要可在数据库中重建 JSON 投影；正文不做数据库可编辑副本。

哈希使用 SHA-256，解码后统一 CRLF/CR 到 LF，不 trim 或删除段落。revision 在语义内容或依赖状态变化时递增。记录 observedHash 使同一外部变更只传播一次。空文件、缺失、非法编码都阻塞而不重建；作者修复原路径后重新扫描。

### 3. 显式扫描保障操作正确性

正文详情、确认、生成/续跑入口扫描全部已存在章节；首次接管已有未登记文件时将其视为作者草稿，不覆盖。读到变化后用 revision 条件更新元数据，撤销本章人工接受，使审核和摘要失效，递增全书 revision、撤销整书完成，其后已存在章节需复核。项目曾 done 时恢复为 prose/idle，阻塞继续生成。

不依赖文件监听确保正确性；首版轮询/手动刷新即可。数据库状态更新与应用生成共用项目执行权，避免检查与生成无序竞争；外部编辑无法加锁，因此每次实际提交仍需再次验证文件和依赖。快照前后文件信息变化时重读，不使用半份读取确认。

备选：仅监听事件容易漏掉原子保存、重启期间改动；仅 mtime 不能可靠判断内容。

### 4. 正文子图管理章内状态

新增正文子图节点：reconcile → selectChapter → generate → aiReview → summarizePending → humanAccept → advance。机器审核结论与人工确认状态独立；手动和自动模式均在 humanAccept 持久化中断，最后一章也须人工接受。此行为明确取代此前“自动模式自动确认正文”的方案，其他阶段的 auto 语义不变。

```text
generate --> aiReview -- accept --> pendingSummary --> humanAccept --> advance
                 |                                        |
                 v                                        v
          polish / rewrite                            reject / edit
                 |                                        |
                 +--> human revision / override       aiReview again
```

polish/rewrite 暂停，不自动改稿或循环返工。作者可本地修改或生成候选并采用，再审核；也可提交非空理由授权越过该报告的 AI 门禁。授权绑定 reviewId、正文哈希和依赖版本，保留原 verdict，之后生成待接受摘要，仍由作者最终接受。调用失败不等同于审核未通过，不能强制接受缺失/无效报告。

摘要先于人工接受生成但保持 pending，不进入后文上下文。人工接受携带 expectedRevision、expectedHash、reviewId、summaryId，校验正文、前文依赖、审核和摘要均为当前版本后，事务写 confirmedHash 与接受记录，使摘要生效。重复接受同一组版本幂等。摘要失败只重试摘要，审核失败只重试审核；摘要期间正文或依赖改变则作废机器结果。拒绝后暂停，不自动进入下一章；未改正文可复用同版机器结果，修改则必须重新审核。

需复核章节保留原文，使用更新的前文摘要重新 AI 审核、生成待接受摘要、人工接受。不能跳过机器步骤直接复核确认。全书 done 必须所有章节有有效人工接受记录及对应摘要；缺失 checkpoint 从最早未完成步骤恢复。运行预算覆盖正文、审核、摘要及各自重试，人工等待不占运行租约。

### 5. 生成上下文和摘要预算

正文调用使用 `LlmService.complete`；审核和摘要使用 `completeStructured` 与共享 zod schema，注册独立版本模板。上下文包括问卷固定维度、种子、必要世界观/人物/关系、全书规划、本章概要/节拍、前文摘要及上一章结尾。外部正文和上游资料均作为数据边界传入，不能覆盖系统指令。

摘要包含事件、人物状态变化、伏笔、衔接信息，并绑定正文哈希与已确认前文指纹。同版重复接受复用机器结果，只有已人工接受摘要才进入前文上下文。预算由类型/篇幅配置管理：正文目标长度从章纲已有信息可得时采用，否则使用篇幅配置；首版无新增问卷项。摘要上下文采用明确的字符上限，近章优先、保留远期紧凑事件及未解决伏笔，绝不注入全书正文；记录裁剪情况。字数目标是提示词指导，不将文学质量或精确字数误作结构校验保证。空白输出、截断或无效响应不得标记成功，保留候选供检查。调用用量按 traceId 幂等累计到项目、阶段和章节，失败调用已知用量也累计。

### 5.1 AI 审核报告与判定

审核必须读取当前章节完整正文和所有前文已接受摘要；第一章前文为空。另附本章概要/节拍、相关人物与世界规则、作者视角/基调/禁忌，上一章结尾作为可选补充。上下文不足时不静默省略或截断本章；返回可定位预算错误并阻塞审核。长篇可无损分批审阅前文摘要并合并报告，记录覆盖章号，最终报告须覆盖全部前文，不把未覆盖当作无问题。

七维度：consistency（设定）、character（人设）、pacing（节奏）、continuity（连贯）、foreshadow（伏笔）、hook（钩子）、aesthetic（审美）。每维整数 0–100；分数供解释，verdict 从 issues 严重度确定：有 critical 为 rewrite，否则有 error 为 polish，仅 warning 或无问题为 accept。

每条 issue 包含维度、严重度、问题、当前正文引用/定位、依据和修改建议；跨章矛盾带来源章号及摘要引用。程序验证正文引用确实存在，不接受无证据报告；审美问题也须引用原文，统计结论必须有确定性统计来源，首版不要求全书风格统计。机械禁忌违规映射现有维度；钩子、节奏按章节功能评价，结局章不强制悬念。

报告绑定正文哈希、上游/前文指纹和提示词版本；本地编辑、候选采用和前文变化均使其失效。新报告与历史原判保留，`reviews/` 仅为可重建投影。审核不能覆盖作者文件。强制接受不修改 AI verdict，也不能豁免文件缺失、旧版本、上游未确认或前文未接受等硬门禁。

### 6. 原文保护与文件恢复协议

首次生成使用候选结果文件和 ProseOperation 准备记录，然后以排他创建将完整结果发布到尚不存在的章节路径。并发出现文件则保留该文件，候选待处理。

重生成始终只产生候选稿，由作者在本地编辑器合并到正文。应用不提供覆盖既有正文的 API，也不执行 rename 替换。合并后扫描变化，撤销旧审核、摘要及接受，后文进入复核。候选的来源哈希和依赖指纹用于提示差异，不授权覆盖文件。

候选稿被本地删除或暂时不可读时，详情保留其操作 ID、路径与来源哈希，并返回 missing/unreadable 状态及提示；正文、审核和摘要继续可用。文件恢复后重新读取即恢复 valid 状态。路径穿越及符号链接安全校验仍须拒绝，不作为普通文件缺失处理。

首次发布只向不存在路径排他创建；操作阶段 prepared / published / committed / conflict 用于启动对账。文件匹配结果哈希时补交未确认元数据；否则认作作者文件，不覆盖。取消或旧运行不得推进状态，残留文件视为未确认草稿。所有候选保留到永久删除。

### 7. 上游失效与正文复核分层

单章节拍编辑撤销整书节拍确认，同时只将对应正文标记上游失效，后文标记需复核；此前正文保持有效。重新确认整书节拍后，可编辑对应章适配新节拍并确认，或生成候选再采用；原文始终保留。全书大纲/更上游失效时所有正文上游失效，先修复上游，再按顺序确认符合新设定的正文或采用候选。通用回退仍保留原有下游失效语义，正文恢复以最新依赖重新确认，不以旧文件存在直接跳过。

### 8. API 与前端边界

所有请求/响应 schema 先定义在 shared，控制器使用 schema 校验。正文路由建议位于 `/api/novel/projects/:id/prose`（最终保持现有控制器前缀）：GET 全书进度与本地路径、GET 单章最新内容、POST 单章 retry（恢复审核或摘要）、POST 单章 override（理由必填）、POST 单章 confirm（最终人工接受）、POST regenerate；单章详情包含只读候选。生成/续跑沿用项目运行入口。确认和覆盖授权均要求 revision/hash；非法依赖 400、资源缺失 404、版本或运行冲突 409。

单章路由在领取运行权之前，将章号校验为安全范围内的正整数；正文服务也校验直接传入的章号。非法章号返回 400，不初始化正文记录、不修改项目状态、不调用模型。

前端提供章节列表、Markdown 阅读、路径复制、本地编辑说明、刷新、确认、摘要重试、候选对比和本地合并指引。展示七维评分、带证据问题、原始 verdict、强制接受理由、待接受摘要及最终接受入口；明确区分审核执行失败/审核未通过/待人工接受/需复核/文件异常/摘要失败；保留运行进度和章节错误。Markdown 渲染禁用不可信原始 HTML。

### 9. 项目生命周期

永久删除在事务内按 deletedAt、runId 和运行状态领取执行权，并持久化删除意图；恢复在事务内拒绝任何已有删除意图的项目，失败后只允许清理重试。生成领取执行权时再次要求项目未删除。进程重启释放被中断的删除租约但保留意图，避免恢复部分已清理的项目。

软删除只停止应用操作、保留目录，恢复时对账外部改动。永久删除增加可重试清理记录，先封禁项目创作，再清理专属目录、用量与 checkpoint，最后完成数据库删除；失败保留重试信息。清理只接受数据库关联的安全 projectId 路径，不跟随链接。文件系统与数据库需一起备份才能完整恢复一本书。

## Risks / Trade-offs

- [外部编辑与应用写入竞争] → 候选优先、本地合并、只创建新文件及提交后对账；不承诺任意编辑器协作下的严格文件事务。
- [文件扫描随书增长增加 I/O] → 仅扫描已存在章节，首版优先正确性，后续可用元信息加速但关键操作仍核验内容。
- [摘要遗漏细节导致续写偏差] → 本章节拍约束、近章原文结尾和结构化摘要；作者逐章审阅，不宣称自动一致性保证。
- [运行进度与文学确认混淆] → 独立状态维度，全书完成必须重新检查所有文件和依赖。
- [AI 误判和评分漂移] → 严重度规则、证据核验、提示词版本及有理由的人工覆盖；评分不直接控制门禁。

## Migration Plan

1. 核对已同步的 story-beats 主规范，新增 shared 契约和 additive Prisma 迁移，不回填虚构正文。
2. 创建被忽略的输出根目录，旧项目首次进入 prose 时初始化记录；遇到同路径已有文件时保留并登记为待确认。
3. 接入文件服务、对账、正文子图、API 和工作台，新增行为以本变更 specs 为验收依据。
4. 在临时输出根目录验证失败、冲突、重启、删除及逐章确认；完成测试、lint、格式与构建后部署。
5. 回滚保留新增表、正文、候选稿，旧应用不运行正文功能；不删除作者文件。升级后先对账再恢复。

### Verify 修复补充

- 人工接受返回本次是否新增有效接受；重复接受直接返回当前结果，不重新推进图，也不清除下一章的失败状态。续跑由独立生成入口触发。
- 正文选择、对账和章节操作都限制在当前目标章数内；超出范围的数据库记录和 Markdown 保留，不参与阶段完成与续跑判定。
