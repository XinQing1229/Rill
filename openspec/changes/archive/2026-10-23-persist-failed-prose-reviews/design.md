# Design

## Context

ProseService 在 completeStructured 返回后校验本章与前文证据；catch 仅写 ProseReview.status/error。成功报告才写 data 并投影 reviews JSON。报告读取已限定 status=done。LlmService 不暴露供应商原始响应，调用失败时业务层可能没有结果。

## Goals / Non-Goals

**Goals:** 保留已取得的失败审核内容，使用唯一审核 ID 关联数据库和文件，继续阻塞无效报告。

**Non-Goals:** 本次不增加自动审核重试、修改引用匹配规则、失败报告 UI 或供应商原始 HTTP 响应采集；此前已丢弃的模型输出无法补回。

## Decisions

### 失败诊断使用独立 schema

在 shared 定义失败诊断结构，包含 formatVersion、status=failed、reviewId、chapterNumber、sourceHash、dependencyFingerprint、promptVersion、failedAt、error 及 output。output 允许未知 JSON 结果或 null，以保留业务层收到但未通过 schema 校验的对象；必须先捕获返回值，再 parse。该结构不扩展有效报告 schema，避免无效结果进入已有有效报告读取路径。

### 复用数据库字段与投影服务

失败诊断写入 ProseReview.data，保留 status=failed 和 error。投影使用现有安全文件服务及 `reviews/{章号}-{审核ID}-failed.json`，审核 ID 确保重试不覆盖历史记录。成功报告格式保持原样，无迁移。单独文件无法支持磁盘异常后的排查，因此数据库保留完整诊断。

### 保存次序与异常处理

在现有运行提交保护下先持久化失败状态和诊断，再写 JSON 投影。投影失败保留原诊断，在错误信息中同时注明原审核失败与投影失败；不将投影异常当成新的审核结果或丢掉原错误。不在控制台输出模型全文、提示词或配置。诊断内容仅含审核结果和必要版本元数据。

### 明确可保存的边界

业务层未收到结果时 output=null，保存安全错误原因；不修改通用 LLM 传输层去抓取原始响应。证据校验错误需带 issue 索引和对应字段，具体引用保留在 output 中。沿用取消、删除与旧运行提交约束。

## Risks / Trade-offs

- [文件投影失败] → SQLite 保留诊断，同时明确文件未写入；后续可从记录排查。
- [历史错误无法复原] → README 明确功能对后续审核生效，旧记录仍可只有 error。
- [诊断被误当有效报告] → 维持 status=done 过滤和现有接受门禁。

## Migration Plan

无需数据库迁移。部署后新失败审核开始保留诊断；回滚保留这些数据库记录及文件，旧实现忽略 status=failed 的 data。
