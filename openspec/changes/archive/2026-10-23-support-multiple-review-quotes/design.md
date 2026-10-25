# Design

## Context

仓库已有 evidence 和 previousEvidence.quotes 数组契约及部分提示词修改；ProseService 仍以 includes(issue.evidence) 校验并读取 previousEvidence.quote，工作台同样使用旧字段。历史 SQLite 有单字符串报告，失败诊断保存原始返回结果。参见 proposal.md 的实际问题。

## Goals / Non-Goals

**Goals:** 新结果严格采用数组，服务端逐段匹配，展示和历史读取可用。

**Non-Goals:** 不增加模糊匹配、不修改正文、不自动修复引用或循环审核；本次不更改失败报告落盘格式。

## Decisions

### 严格输出与兼容读取分开

ProseIssueSchema 继续要求 evidence:string[]、previousEvidence:{chapterNumber,quotes:string[]}。片段使用原始字符串，仅验证非空白，不 trim 或改写引用。数组至少一项。新模型输出不接受字符串与数组的联合类型，避免模型继续输出拼接字符串。

历史已完成报告进入 ProseReviewReportSchema 前，通过单独兼容函数将 evidence 字符串包装成数组，并将 previousEvidence.quote 转换为 quotes:[quote]。仅适配数据库读取，不写回历史记录、不用于新模型输出、不触碰失败诊断 output。

### 精确校验片段

每个 evidence[i] 在当前完整正文中执行独立 includes；任何失败明确 issues[x].evidence[y]。跨章 quotes[i] 在指定章号的已接受摘要字段中逐个匹配，单段不得跨字段人为拼接。保留来源章号及既有全前文覆盖检查。不忽略空白或标点；模型需要跨段时用多个片段。原文本身含省略号时精确匹配即可通过。

### 提示词版本与显示

为 prose-review 注册并选用 v2，数据库 promptVersion 与实际渲染版本一致。只调整审核版本选择，不覆盖已有草稿和摘要模板修改。提示词给出多片段数组示例，要求照抄连续原文，明确禁止自行添加省略号。

工作台将 evidence 与 quotes 分别逐项渲染为引用块，跨章片段保留章号标签和原文空白，避免 React 把数组直接连接成一段。刷新、复核和人工接受流程沿用现有逻辑。

## Risks / Trade-offs

- [旧报告 schema 不兼容] → 读取适配，单独验证旧报告展示与接受幂等，不直接迁移历史 JSON。
- [部分调用链仍假设字符串] → 搜索全部 evidence/quote 使用点及 mock，覆盖 shared、后端和前端构建。
- [模型仍自行拼接] → 精确校验阻断，失败诊断保存完整数组与片段下标。

## Migration Plan

无数据库迁移。前后端一并构建部署，新审核使用 v2；历史报告只在读取时适配，备份与文件路径保持现状。旧版本不支持新数组报告，回滚需保留新版报告并使用兼容应用读取。
