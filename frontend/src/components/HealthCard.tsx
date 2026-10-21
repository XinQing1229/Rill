import { useEffect, useState } from 'react';
import { Alert, Card, Skeleton, Typography } from 'antd';
import type { HealthResponse } from '@rill/shared';
import { getHealth } from '../api/client';

const { Text } = Typography;

export function HealthCard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card title="后端健康检查" style={{ marginBottom: 16 }}>
      {loading && <Skeleton active paragraph={{ rows: 1 }} />}
      {!loading && error && <Alert type="error" message={`后端连接失败: ${error}`} showIcon />}
      {!loading && health && (
        <Alert
          type="success"
          message={`服务正常（状态: ${health.status}）`}
          description={<Text type="secondary">时间戳: {health.timestamp}</Text>}
          showIcon
        />
      )}
    </Card>
  );
}
