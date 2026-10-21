# Design

## Context

种子阶段已落地：`premise` 产物 + 问卷驱动生成 + 阶段状态机（每阶段一产物一确认点、回退使下游 stale）。`world` 与 `characters` 是已占位但无生成器的空阶段，且 `relations` 阶段尚不存在。动机见 proposal.md - Why。

## Goals / Non-Goals

**Goals:**

- 上游产物由流水线统一装配，生成器以纯逻辑消费上下文
- 世界观 = 通用骨架 + 类型自定义块，`era`/`place` 从种子继承
- 人物从种子主角扩展，数量可控且保底主角
- 关系网规范化去重、方向可表达，人物重生成联动关系失效
- 各产物可单独重新生成
- 提供人物与关系查询 API

**Non-Goals:**

- 不做前端界面（仅提供查询 API）
- 不做事后一致性校验（如人物能力是否超出世界观规则，第一版仅靠 prompt 注入约束）
- 不建势力表、不做人物状态随时间演变（中长篇特性，记入演进路径）
- 不改 `novel-pipeline` 的既有规范行为

## Decisions

### 决策 1：上游产物经流水线装配，生成器纯逻辑消费

- 定义 `StageContext`：`{ premise?, world?, characters? }`，只包含**已确认且未失效**的产物
- `ArtifactRegistry` 从「登记 stale 更新器」扩展为「登记生成器 + 声明上游依赖」：

```ts
interface StageGenerator<T> {
  readonly stage: Stage;
  readonly requires: Stage[];   // 声明依赖哪些上游阶段
  generate(ctx: StageContext, answers: QuestionnaireAnswers): Promise<T>;
}
```

- 流水线职责：查库 → 过滤 stale/未确认 → 装配 context → 调用生成器 → 写库并推进状态
- **理由**：stale 过滤与「只读已确认」只有一处实现，绕不过去；生成器变成纯函数，单测直接构造 context
- **备选**：生成器自行查库（查询逻辑分散、可能读到 stale、测试需 mock 多个查询）

### 决策 2：阶段列表扩展至 7 个

- `STAGES` 增加 `relations`：`premise → world → characters → relations → outline → beats → prose`
- 每阶段仍是一产物一确认点，状态机零改动
- `stagesFor()` 继续按类型过滤（都市/言情跳过 world）

### 决策 3：三张表，JSON 存类型特有属性

```prisma
model WorldSetting {
  projectId  String @unique
  data       String          // 通用骨架 + 自定义块，JSON 字符串
  status     String @default("pending")
  stale      Boolean @default(false)
  promptTokens / completionTokens Int @default(0)
}

model Character {
  projectId  String
  name       String          // 建列：按名查询
  role       String          // protagonist / supporting / antagonist
  data       String          // 完整人物卡 JSON
  status     String
  stale      Boolean @default(false)
}

model Relation {
  projectId  String
  fromId     String          // 规范化：fromId < toId
  toId       String
  type       String          // 师徒/仇敌/亲人/利益/...
  fromRole   String          // 方向性：A 相对 B 的角色
  toRole   String
  description String
  data       String          // 扩展属性 JSON
}
```

- 与既有约定一致：SQLite 不支持 enum/Json，枚举用 String、结构化内容用 JSON 字符串

### 决策 4：世界观双层 schema，era/place 继承

- 通用骨架（`@rill/shared`）：`summary` / `rules[]` / `factions[]`（`geography` / `history` / `secrets` 仅 detailed 档产出）
- 类型自定义块：每个 genre profile 挂一个 zod schema（玄幻=力量体系、科幻=科技树、历史=制度、悬疑=谜题规则）
- 校验：`z.intersection(通用, 自定义)`，生成期严格校验
- **`era`/`place` 不从模型生成**：从 `premise.setting` 继承后由系统填入返回结构，与问卷「已选维度不进 schema」同款原则

### 决策 5：人物 schema 与主角扩展规则

- 字段：`name` / `role` / `identity` / `desire` / `flaw` / `personality` / `background` / `abilities` / `arc`
- **第一个人物必须是种子主角的扩展**：`identity`/`desire`/`flaw` 与 `premise.protagonist` 一致或在其上扩展，`name` 可沿用或细化
- 数量：`length profile` 默认值（短篇 4）+ 问卷选答覆盖（精简/标准/丰满）；保底返回含 `role=protagonist` 的人物
- 返回结构为人物数组，逐条入库

### 决策 6：关系规范化与联动失效

- 生成时模型输出无序对，入库前按 `fromId < toId` 规范化；重复对只保留一条（后写覆盖或合并描述）
- 方向性用 `fromRole`/`toRole` 表达（如 fromRole=师父、toRole=徒弟）
- **联动规则**：重新生成人物时，人物行被重建，关系因外键级联被移除，关系阶段回到待生成（引用已不存在人物的关系本就是脏数据，不保留）；重新生成关系不影响人物
- 关系生成以**已确认的人物列表**为上下文

### 决策 7：模板复用

- 抽 `renderUpstreamContext(ctx)` helper：把种子/世界观/人物渲染成稳定的 prompt 段落（稳定前缀在前，命中缓存）
- world/characters/relations 三个模板都调用它，避免重复拼接

### 决策 8：查询 API

- `GET /api/novel/projects/:id/characters` → 人物列表（含状态）
- `GET /api/novel/projects/:id/relations` → 关系列表（含双方 id、类型、相对角色）
- 不合并为 graph 端点：前端关系网可自行组合两次查询，且人物/关系的失效状态需分别可见

### 决策 9：降级

- 无 world 产物时（都市/言情）：`StageContext.world` 为 undefined，模板不渲染世界观段落，人物与关系照常生成
- 单测专门覆盖此路径

## Risks / Trade-offs

- [人物能力可能超出世界观规则] → 第一版仅在 prompt 注入 rules 约束，不做事后校验；待质量数据积累后再评估
- [两次调用 + 人物多条，token 成本上升] → 已有 traceId 用量埋点，可按阶段观测；超预期再优化 prompt 长度
- [人物重生成导致关系失效，用户需再确认一次] → 明确的联动规则优于静默过期；UI 上失效状态可见
- [关系规范化可能丢失模型的语义细节] → 保留 `description` 原文，规范化只用于去重
- [中长篇需要势力表与人物状态演变] → 本次不建；实体类型达 3 类以上时抽通用实体表（既定演进路径）

## Migration Plan

不适用（新增能力）。回滚方式：revert 本次提交并回退迁移。

## Open Questions

- 关系类型是否收敛为枚举（当前为自由文本 + 描述）：等前端关系网需要筛选/着色时再定。
