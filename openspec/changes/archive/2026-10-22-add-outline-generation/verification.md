# Verification Report: add-outline-generation

日期：2026-10-22。Schema：spec-driven。

## 结论

**本次核验未通过，暂不建议归档。** 26 项任务均已勾选，13 条需求均能找到实现，但隔离补充复现确认了 2 处阶段推进问题。另外有 3 项警告需要处理或明确记录。

本轮仅核验并生成报告，未修复业务代码、未更改任务勾选、未归档。既有验收记录中的成功路径与真实模型结果仍然有效，但不能覆盖本次发现的反例。

## Summary

| 维度 | 结果 |
| --- | --- |
| Completeness | 26/26 任务勾选；13 条需求、30 个场景已检查实现与现有测试 |
| Correctness | 2 处已复现的推进缺陷；现有测试未覆盖相应入口/回退组合 |
| Coherence | 主图/子图、版本隔离与共享契约总体符合设计；用量与内容的事务边界偏离设计 |

## CRITICAL：归档前修复

### C1 / P1：从关系阶段 checkpoint 进入大纲后，父图旧状态覆盖当前阶段

位置：`backend/src/novel/pipeline/pipeline.service.ts:519-525`；子图注册见 `backend/src/novel/pipeline/pipeline.graph.ts:78-91`。

触发：手动模式生成关系并在其后暂停，再确认关系进入大纲。大纲子图已经写入规划并暂停于 plan_review，但父图尚未收到子图最终输出，父图返回的 currentStage 仍是 relations。runGraph 将该值回写到 Project，覆盖节点已写入的 outline。

隔离复现结果：`Outline.step = plan_review`，但 `Project.currentStage = relations`（期望 outline）。大纲工作台因此将编辑/确认视为非当前阶段；携带规划确认目标时也会被“请先回退到大纲阶段”拒绝。

关联：`novel-pipeline` 的确认后推进、`outline-generation` 的全书规划确认流程；任务 4.1、7.1。

建议：项目当前阶段应以实际运行节点持久化的业务进度为准，或在父图进入子图前同步父图阶段；不能在子图 interrupt 时无条件回写父图旧值。补充从 relations 的真实 checkpoint 进入 outline 的回归，保留最后阶段完成状态的原有语义。

复现核心步骤（在现有 outline.service.spec.ts 的隔离 fixture 中）：

```ts
artifacts.registerStorage('relations', prisma);
artifacts.registerGenerator({
  stage: 'relations', requires: () => [], generate: async () => undefined,
});
await prisma.project.update({ where: { id }, data: { currentStage: 'relations' } });
await prisma.stageRun.updateMany({
  where: { projectId: id, stage: 'relations' },
  data: { status: 'pending', confirmedAt: null },
});
await pipeline.generate(id, { wait: true });
await pipeline.confirm(id);
expect((await outline.get(id)).step).toBe('plan_review');
expect((await pipeline.get(id)).currentStage).toBe('outline'); // 实际 relations
```

### C2 / P2：回退到已确认大纲后，再次确认被幂等短路，不能推进

位置：`backend/src/novel/outline/outline.service.ts:320-322`、`backend/src/novel/pipeline/pipeline.service.ts:248-250`。

触发：完整大纲已确认并进入后续阶段，作者回退到 outline，保留大纲内容而不编辑，再确认。rollback 保留 confirmedRevision，checkConfirm 因版本已经确认返回 false，PipelineService 直接返回项目；当前阶段仍为 outline。界面也只在 outline_review 显示完整确认按钮，confirmed 状态没有对应确认推进入口。

隔离复现结果：回退后确认请求正常返回，但没有运行后续节点，Project.currentStage 仍为 outline。现有 suite 只验证“离开大纲后重复确认不重复生成”，没有验证“显式回退后重新推进”。

关联：`novel-pipeline` 的确认后进入下一阶段及既有回退恢复语义；任务 4.4。

建议：区分“已在下游时的重复确认”与“显式回退后的推进意图”。后者应从已确认有效大纲继续到下一阶段，且不重生成已有内容；前端提供相应操作。补充回退且不编辑的回归。

复现核心步骤：

```ts
// 已生成并确认完整大纲，流程已到 beats（当前 beats 为占位节点）。
await pipeline.rollback(id, 'outline');
await pipeline.confirm(id, 'confirm', {
  target: 'outline', expectedRevision: detail.revision,
});
expect((await pipeline.get(id)).currentStage).toBe('beats'); // 实际 outline
```

## WARNING：建议修复或明确说明

### W1：前端未展示失败批次的位置

位置：`frontend/src/components/outline/OutlineWorkbench.tsx:185-197`；返回契约见 `shared/src/index.ts` 的 OutlineDetail.batches。

API 已返回批次起止章号、status 与 error，但工作台只展示总完成数量及顶层 error，不消费 batches。顶层错误不带批次位置时，作者无法直接看到哪一批、哪些章节失败。现有组件测试把“第三批失败”直接写进 mock error，未验证真实批次元数据的呈现。

关联场景：`novel-frontend/续跑失败分段`。

建议：展示失败批次的 startChapter/endChapter 和对应 error；使用不含位置的通用错误文本加真实 batches 元数据测试，避免靠模拟消息代替界面逻辑。

### W2：成功批次的用量与产物采用两个事务

位置：`backend/src/novel/outline/outline.service.ts:529-539`、`:592-621`。

设计要求批次内容、完成状态与对应已知用量原子提交；实现先在 call 的 finally 提交账本/用量，返回后再提交批次内容和 done 状态。两事务间中断会出现已记用量但批次未完成，恢复后再次调用模型。唯一 traceId 可防止同一次账本提交重复，但不消除这一窗口。

建议：成功调用的内容、done 状态与用量在一个事务提交；失败调用仍单独记录已知用量。若有意分离事务，则明确修订设计、说明恢复与账本策略，并补充两事务间中断测试。此项为设计一致性警告，不等于重复计费：重新发起的真实模型调用本身确实产生用量。

### W3：全新 checkpoint 文件下首次 force 生成会因表未初始化失败

位置：`backend/src/novel/pipeline/pipeline.service.ts:210-214`；初始大纲界面也提供“重新生成全书规划”入口。

补充复现最初使用全新临时 checkpoint 库、首次 generate(force: true)，在 deleteThread 处直接抛出 `SqliteError: no such table: checkpoints`，尚未执行模型调用。这是既有 checkpoint 删除入口的问题，但新大纲界面会暴露该路径。

建议：删除 checkpoint 前保证持久化器已初始化，或对尚未建立的 thread/表安全幂等处理；补充冷启动首个 force 请求测试。也可在无规划时隐藏不适用的重生成入口，但不能仅依赖前端保护。

## 需求实现与场景映射

下表表示找到实现与测试证据，不代表每条需求已完全通过。

| 能力/需求 | 主要实现 | 现有证据与缺口 |
| --- | --- | --- |
| 作者决定目标章数 | shared schema、OutlineService.configure | 默认 8/40/200、自定义、非法整数测试 |
| 全书规划使用已确认设定 | OutlineService.upstream/plan、上下文适配 | 空关系、跳过世界观、人物弧光、世界秘密与类型块测试 |
| 全书规划可编辑且确认后才展开 | savePlan、review、acceptConfirmation | 保存/确认分离与版本校验；C1 影响正常上游进入后的操作 |
| 按规划分段生成每章概要 | splitBatches、validateChapters、expand | 连续章号、引用校验及 200 章顺序分批测试 |
| 每章概要可编辑并整体确认 | saveChapter、acceptConfirmation | 人工编辑供下游读取、前端编辑及未保存禁用测试 |
| 编辑与上游变更使依赖结果失效 | edit、阶段存储 invalidate | 规划版本失效及旧章纲回看测试 |
| 内部步骤持久化与分段续跑 | 子图、批次记录、runGraph | 第三批失败/重启、丢失 checkpoint 后恢复测试；C2 缺少回退组合 |
| 修改与确认遵守版本及运行互斥 | commitGeneration、项目租约、revision | 并发修改拒绝、过期运行及超时迟到结果测试 |
| 统一 AI 能力与用量 | prompt/model registry、call、OutlineUsage | 重试累计与幂等；W2 为事务边界偏差 |
| 手动模式下需确认后推进 | 父图、子图、PipelineService.confirm | 两次确认与自动 200 章；C1/C2 反例未被原测试覆盖 |
| 大纲内部步骤与章节规模可见 | OutlineWorkbench | 默认/自定义章数、进度、200 章折叠展示测试及既有桌面验收 |
| 大纲结构化编辑与分步确认 | OutlineWorkbench 表单及独立动作 | 规划/单章编辑、非法输入、目标版本与确认测试 |
| 大纲冲突与失效反馈 | OutlineWorkbench.act/withImpact | 冲突保留、禁用、失效范围提示；失败位置缺口见 W1 |

## 验证方法与范围

- 读取 proposal、design、tasks、3 份 delta specs 及 acceptance；核对阶段图、服务、存储、共享契约、API 与前端编辑组件。
- 使用现有 fixture 的副本建立临时隔离测试，确认 C1 和 C2；未修改原有测试。复现用文件已清理，核心步骤保留在本报告中。
- 当前变更标记为 all_done 只代表 tasks 已勾选，不代表通过此核验。
- 上轮全仓 259 项测试、lint/build/format 成功以及真实 DeepSeek 8 章和桌面验收，作为历史证据引用，本轮没有再次调用付费模型或重复浏览器验收。
- 本轮重跑的现有大纲单测、HTTP、组件测试与严格校验结果见下方最终记录。

## 下一步

先修复 C1、C2，补上相应回归并处理或明确记录警告，再重新执行 `/opsx:verify add-outline-generation`。本次不执行 archive。

## 本轮最终记录

- 现有大纲后端测试：16/16 通过（含迁移）。
- 现有大纲 HTTP 测试：2/2 通过。
- 现有大纲前端组件测试：10/10 通过；有 useForm/getComputedStyle 测试环境提示。
- `openspec validate add-outline-generation --strict` 与 `git diff --check`：通过。
- 补充反例：C1 当前阶段实际 relations（期望 outline）；C2 回退后确认正常返回但不推进，均已复现。
- 既有测试通过与新增反例失败同时成立，说明缺少相应跨阶段/回退组合回归；不能据既有绿色结果宣告本次 verify 通过。
