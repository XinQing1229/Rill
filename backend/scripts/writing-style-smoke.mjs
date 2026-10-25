import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import configuration from '../dist/src/config/configuration.js';
import { parseAiConfig } from '../dist/src/ai/config/ai.config.js';
import { ModelRegistry } from '../dist/src/ai/models/model.registry.js';
import { PromptRegistry } from '../dist/src/ai/prompts/prompt.registry.js';
import { UsageRecorder } from '../dist/src/ai/observability/usage-recorder.js';
import { LlmService } from '../dist/src/ai/llm.service.js';
import { proseTemplates } from '../dist/src/novel/prompts/prose-template.js';
import { renderWritingStyle } from '../dist/src/novel/writing-style/writing-style.registry.js';

// 仅使用合成故事做小样对照，不创建或修改项目，不输出环境变量或凭证。
loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const settings = parseAiConfig(configuration().llm);
if (!settings.apiKey) throw new Error('未配置模型凭证，无法运行真实样稿验收');
const llm = new LlmService(
  settings,
  new ModelRegistry(settings),
  new PromptRegistry(),
  new UsageRecorder(settings),
);
const style = { id: 'short-satisfying', version: 'v1' };
const cases = [
  {
    title: '都市与轻松',
    genre: 'dushi',
    tone: '轻松',
    event:
      '经理在客户演示会上把林舟的方案署名给侄子。林舟此前已把带版本记录的交付文件发给客户。侄子解释不出方案核心，林舟应客户要求演示并拿回项目署名。结尾交代结果，不增加新冲突。',
  },
  {
    title: '言情与暗黑',
    genre: 'yanqing',
    tone: '暗黑',
    event:
      '订婚宴前，沈宁发现未婚夫把她的工作室抵押给家族。她已保留未授权的文件和双方通信。在宴会上她取消订婚并出示证据，合作方依合同解除抵押安排，沈宁带走自己的作品离开。不得靠新身份或暴力解决。',
  },
  {
    title: '悬疑与紧张',
    genre: 'xuanyi',
    tone: '紧张',
    event:
      '证物室管理员许言被指控调换证物。她已发现交接单时间与门禁停电时间矛盾，停电时门只能从里面打开。她在复核会上对照两份记录，证明值班主管提前进入并伪造交接。主管承认违规取走证物，许言洗清嫌疑。不能凭空加入证据。',
  },
];
const lines = [
  '# 短篇爽文真实模型小样对照',
  '',
  '日期：2026-10-24',
  '',
  '范围：三组固定章纲的正文小样，比较通用策略和短篇爽文 v1。不是完整小说或商业效果验证。调用现有 LlmService、模型配置与正文模板，不运行项目流水线。',
  '',
];
for (const item of cases.filter(
  (item) => !process.env.RILL_SAMPLE_CASE || item.genre === process.env.RILL_SAMPLE_CASE,
)) {
  lines.push(`## ${item.title}`, '', `固定事件：${item.event}`, '');
  for (const enabled of [false, true]) {
    const data = {
      answers: {
        genre: item.genre,
        length: 'short',
        tone: item.tone,
        pov: '第三人称限知',
        ...(enabled ? { writingStyle: style } : {}),
      },
      chapterNumber: 1,
      previous: [],
      context: {
        outline: {
          plan: { ending: '本章结束时解决主要冲突' },
          chapters: [{ number: 1, events: item.event }],
        },
      },
    };
    const template = proseTemplates.find((entry) => entry.name === 'prose-draft');
    const prompt = template.render({
      data: JSON.stringify(data),
      writingStyle: renderWritingStyle(enabled ? style : undefined, 'prose'),
    });
    const result = await llm.complete(
      [
        { role: 'user', content: prompt },
        { role: 'user', content: '本次为独立小样，正文约400至600字，完整收束，不附解释。' },
      ],
      { usage: 'draft', maxTokens: 1600, signal: AbortSignal.timeout(90000) },
    );
    if (result.finishReason === 'length') throw new Error('样稿输出被截断，不能当成完整验收结果');
    lines.push(
      `### ${enabled ? '短篇爽文 v1' : '通用策略'}`,
      '',
      `模型：${result.model}；用量：输入 ${result.usage?.promptTokens ?? '未知'} / 输出 ${result.usage?.completionTokens ?? '未知'} tokens。`,
      '',
      result.content,
      '',
    );
    console.log(`${item.title} / ${enabled ? '短篇爽文' : '通用'} 完成`);
  }
}
await writeFile(
  new URL(
    `../../docs/qa/writing-style-samples-2026-10-24${process.env.RILL_SAMPLE_CASE ? '-' + process.env.RILL_SAMPLE_CASE : ''}.md`,
    import.meta.url,
  ),
  lines.join('\n'),
);
console.log('样稿已保存');
