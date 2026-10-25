# Proposal

## Why

正文审核目前在证据校验失败时仅记录错误字符串，丢弃模型已返回的评分、问题和引用，无法定位具体失败原因。需要将失败审核作为诊断记录持久化，方便作者在本地检查。

## What Changes

- 对每次失败审核保存已取得的模型结构化结果、错误、审核 ID、章号、正文哈希、依赖指纹和提示词版本。
- 在 SQLite 保存失败诊断，并投影到 `reviews/{章号}-{审核ID}-failed.json`；重试保留旧记录。
- 调用未返回结果时明确记录结果缺失，失败诊断不得作为有效报告用于接受或续写。
- 补充 README 对失败报告位置和限制的说明。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `prose-generation`: 增加失败审核诊断的持久化与本地投影要求。

## Impact

涉及 shared 的失败诊断 schema、正文审核失败分支、文件投影及 README。复用 ProseReview.data，无新增数据库迁移或 HTTP 接口。既有有效报告格式和人工接受流程保持兼容。
