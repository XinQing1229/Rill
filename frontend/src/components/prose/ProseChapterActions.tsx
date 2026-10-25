import { Button, Space } from 'antd';

export function ProseChapterActions({
  label,
  disabled,
  loading,
  onPrimary,
}: {
  label: string;
  disabled: boolean;
  loading: boolean;
  onPrimary: () => void;
}) {
  return (
    <Space wrap className="prose-actions">
      {label && (
        <Button type="primary" disabled={disabled} loading={loading} onClick={onPrimary}>
          {label}
        </Button>
      )}
    </Space>
  );
}
