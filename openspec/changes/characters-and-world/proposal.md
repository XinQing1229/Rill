# Proposal

## Why

种子阶段已经能产出 premise，但流水线停在 `world` 和 `characters` 两个空阶段——没有世界观与人物数据，后续的大纲、细纲、正文都无从谈起。更重要的是，人物关系网是长篇一致性的地基：大纲需要人物动机，细纲需要人物状态，正文需要人物语气，全都依赖这份数据。再往后放，等于每个阶段都要临时补人物设定。

## What Changes

- 新增数据模型：`WorldSetting`（项目 1:1）、`Character`（1:N）、`Relation`（1:N）三张表；人物与关系的类型特有属性放 JSON 列
- 新增**上游产物装配服务**：由流水线统一查询上游产物、过滤 stale 与未确认内容，生成器以纯逻辑消费装配好的上下文（生成器不再自行查库）
- 新增 `world` 生成器：世界观 = 通用骨架 + 类型自定义块（zod 交集校验）；`era`/`place` 从种子继承、不由模型生成；详略按类型分档（detailed / light / minimal，minimal 类型跳过该阶段）
- 新增 `characters` 生成器：人物卡列表，第一个必须是种子主角的扩展；数量由篇幅配置默认值 + 问卷选答决定，保底主角存在
- 新增 `relations` 生成器：关系网；用 `fromId < toId` 规范化去重，方向性由 `fromRole`/`toRole` 表达
- **阶段列表扩展**：新增 `relations` 阶段（`premise → world → characters → relations → outline → beats → prose`，都市/言情跳过 world）
- 新增查询 API：人物列表与关系网
- 新增三个阶段的提示词模板，并抽公共的上游上下文渲染 helper 复用
- 人物重新生成时，关系产物标记为失效（关系引用人物）；关系重新生成不影响人物

## Capabilities

### New Capabilities

- `world-and-characters`: 世界观与人物关系网的生成——上游产物经流水线装配后按通用+自定义结构产出，人物从种子主角扩展，关系网规范化去重且方向可表达，各产物可单独重新生成并联动失效

### Modified Capabilities

（无——`novel-pipeline` 的规范级行为不变：阶段列表属数据配置，「按类型与篇幅确定阶段流程」「确认后推进」「回退使下游失效」等既有规则原样适用）

## Impact

- 后端新增迁移：三张表；`STAGES` 类型新增 `relations`
- 新增 `src/novel/world/`、`src/novel/characters/`、`src/novel/relations/` 模块与生成器
- 新增上游装配服务（`ArtifactRegistry` 从「登记失效操作」扩展为「登记生成器 + 声明上游依赖」）
- `@rill/shared` 新增世界观/人物/关系的 schema 与类型
- genre profile 新增：类型自定义世界观 schema、人物规模默认值
- 新增问卷选答：人物规模（精简/标准/丰满）
- 新增 API：人物与关系查询
- 无前端改动（前端界面属于后续 change）
