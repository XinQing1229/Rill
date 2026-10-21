import { useState } from 'react';
import { Alert, Button, Card, Space, Typography } from 'antd';
import type { PingResponse } from '@rill/shared';
import { pingLlm } from '../api/client';

const { Paragraph, Text } = Typography;

export function LlmPingCard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePing = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await pingLlm());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="LLM 连通性验证" style={{ marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button type="primary" onClick={handlePing} loading={loading}>
          发起一次真实调用
        </Button>
        {result && (
          <Alert
            type="success"
            message={`调用成功（模型: ${result.model}）`}
            description={<Paragraph>{result.content}</Paragraph>}
            showIcon
          />
        )}
        {error && <Alert type="error" message={`调用失败: ${error}`} showIcon />}
        {!result && !error && !loading && (
          <Text type="secondary">点击按钮，通过后端向 DeepSeek 发起一次真实补全请求。</Text>
        )}
      </Space>
    </Card>
  );
}
