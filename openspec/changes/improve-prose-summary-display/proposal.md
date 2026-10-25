# Proposal

## Why

正文工作台的摘要直接展示原始 JSON，英文键名、引号和括号干扰阅读，长行也不方便作者逐项核对。需要将已有结构化数据转为清晰的中文阅读界面。

## What Changes

- 将已接受与待接受摘要统一展示为“关键事件、人物变化、伏笔、连续性说明”四个分区。
- 事件按原顺序编号，人物变化与伏笔采用列表，连续性说明采用段落。
- 长文本自动换行并限制阅读宽度；空列表显示明确空态，摘要中的文本安全渲染。
- 保留现有摘要状态标题与人工接受操作。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `prose-generation`：增加正文工作台摘要的可读性、完整性和空态展示要求。

## Impact

主要修改 `frontend/src/components/prose/ProseWorkbench.tsx` 的摘要区域与相邻组件测试。复用 Ant Design 与现有摘要数据契约，无需新增依赖或修改 API、数据库、模型提示词。
