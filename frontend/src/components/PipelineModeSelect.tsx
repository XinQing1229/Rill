import { Radio, Space } from 'antd';
import type { PipelineMode } from '@rill/shared';

/** 创建与设置共用的推进方式说明。 */
export function PipelineModeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: PipelineMode;
  onChange: (mode: PipelineMode) => void;
  disabled?: boolean;
}) {
  return (
    <Radio.Group
      aria-label="推进模式"
      value={value}
      onChange={(event) => onChange(event.target.value as PipelineMode)}
      disabled={disabled}
    >
      <Space direction="vertical" size="middle">
        <div>
          <Radio value="manual">手动推进</Radio>
          <p className="hint" style={{ margin: '4px 0 0 24px' }}>
            每阶段生成后等待你确认，再继续下一阶段。
          </p>
        </div>
        <div>
          <Radio value="auto">自动推进</Radio>
          <p className="hint" style={{ margin: '4px 0 0 24px' }}>
            连续生成，失败或需要人工处理时暂停；正文仍逐章等待你接受。
          </p>
        </div>
      </Space>
    </Radio.Group>
  );
}
