# Tasks

## 1. 数据模型与迁移

- [x] 1.1 在 `@rill/shared` 定义世界观/人物/关系的 schema 与类型（含类型自定义块 schema）— verify: 前后端均可 import 且 `tsc` 无错误
- [x] 1.2 定义 `WorldSetting` / `Character` / `Relation` 三张表（JSON 字符串存结构化内容，状态与 stale 字段齐全） — verify: `prisma validate` 通过
- [x] 1.3 生成并应用迁移 — verify: `prisma migrate dev` 成功，dev.db 含三张表

## 2. 阶段列表与上游装配

- [x] 2.1 `STAGES` 增加 `relations`，阶段列表扩展为 7 个 — verify: 单测验证玄幻类型阶段含 relations 且顺序正确
- [x] 2.2 `ArtifactRegistry` 扩展为「登记生成器 + 声明上游依赖」 — verify: 单测验证注册后可查找到生成器及其依赖声明
- [x] 2.3 实现 `StageContext` 装配服务：查库、过滤 stale 与未确认、按 `requires` 校验依赖 — verify: 单测覆盖上游齐全、上游 stale（拒绝并提示）、上游未确认三种情形
- [x] 2.4 为 premise/world/characters 登记 stale 更新器 — verify: 单测验证回退到 world 后 characters 与 relations 均被标记 stale

## 3. 上游上下文渲染与模板

- [x] 3.1 实现 `renderUpstreamContext(ctx)` helper（稳定前缀在前） — verify: 单测验证不同上下文渲染结果前缀稳定
- [x] 3.2 新增 world / characters / relations 三个阶段的提示词模板（复用 helper） — verify: 单测验证模板渲染包含上游内容且不重复拼接

## 4. 世界观生成

- [x] 4.1 genre profile 增加类型自定义 schema、人物规模默认值、世界观详略档位 — verify: 单测验证每种类型能取到对应 schema 与默认值
- [x] 4.2 实现 `WorldGenerator`：通用骨架 + 自定义块（intersection 校验），`era`/`place` 从种子继承 — verify: 单测 mock 生成结果，断言产物中 era/place 与种子一致
- [x] 4.3 按详略档位裁剪生成范围（detailed 全出 / light 只出 rules+factions / minimal 跳过阶段） — verify: 单测分别验证三档的产出范围

## 5. 人物生成

- [x] 5.1 问卷增加「人物规模」选答（精简/标准/丰满） — verify: 单测验证问卷含该选答且非必填
- [x] 5.2 实现 `CharacterGenerator`：人物卡列表逐条入库，第一个人物为种子主角扩展 — verify: 单测 mock 生成结果，断言入库条数正确且首条的 identity/desire/flaw 与种子主角一致
- [x] 5.3 保底返回含主角的人物 — verify: 单测验证任意规模下均存在 role=protagonist 的人物
- [x] 5.4 无世界观产物时以降级上下文正常生成 — verify: 单测验证 world 为 undefined 时生成成功且 prompt 不含世界观段落

## 6. 关系生成

- [x] 6.1 实现 `RelationGenerator`：以已确认人物列表为上下文生成关系 — verify: 单测 mock 生成结果，断言关系入库且双方 id 均来自已确认人物
- [x] 6.2 规范化去重（`fromId < toId`）与方向性（fromRole/toRole） — verify: 单测输入含重复对与不对称关系，断言只存一条且方向信息保留
- [x] 6.3 联动失效：重新生成人物时既有关系被移除、关系阶段回到待生成 — verify: 单测验证强制重生人物后 relations 的 stale 更新器被调用，真实验证数据库中关系被清空

## 7. API

- [x] 7.1 人物查询接口 `GET /api/novel/projects/:id/characters` — verify: e2e 断言返回人物列表及状态
- [x] 7.2 关系查询接口 `GET /api/novel/projects/:id/relations` — verify: e2e 断言返回关系列表含双方标识与相对角色
- [x] 7.3 上游失效时生成被拒绝并返回明确提示 — verify: e2e 或单测断言拒绝及提示内容

## 8. 真实调用验收与收尾

- [x] 8.1 真实调用全链路：生成世界观 → 确认 → 生成人物 → 确认 → 生成关系 → 确认 — verify: 实际产出结构化世界观、人物卡与关系网，各产物入库且用量被记录
- [x] 8.2 联动失效真实验证：重新生成人物后关系被标记失效 — verify: 数据库中关系 stale=true
- [x] 8.3 全量测试、lint 与格式检查 — verify: `npm test`、`npm run lint`、`npm run format:check` 全部通过
- [x] 8.4 以 conventional commit 提交本次变更 — verify: `git log` 显示提交且不含 `.env` 与 `*.db`
