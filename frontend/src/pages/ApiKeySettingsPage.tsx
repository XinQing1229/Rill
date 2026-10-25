import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import {
  ApiKeySettingsSchema,
  ApiKeyUpdateSchema,
  type ApiKeySettings,
  type ApiKeyUpdate,
} from '@rill/shared';
import { get, post } from '../api/client';

export function ApiKeySettingsPage() {
  const [form] = Form.useForm<{ apiKey: string }>();
  const [settings, setSettings] = useState<ApiKeySettings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setSettings(ApiKeySettingsSchema.parse(await get('/api/llm/settings')));
    } catch {
      setError('无法读取 API Key 配置，请检查后端服务后重试');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const update = async (value: ApiKeyUpdate) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = ApiKeySettingsSchema.parse(await post('/api/llm/settings', value));
      setSettings(result);
      form.setFieldsValue({ apiKey: '' });
      setNotice(
        value.action === 'remove'
          ? 'API Key 已清除。已有小说仍可浏览，AI 功能需重新配置密钥。'
          : 'API Key 已保存，后续模型调用立即生效。',
      );
    } catch {
      setError('保存失败，输入已保留。请检查后端服务及配置目录权限后重试。');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="title-row">
        <div>
          <h1>API Key 设置</h1>
          <div className="sub">配置用于小说创作的 DeepSeek 密钥</div>
        </div>
      </div>
      <Card style={{ maxWidth: 680 }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {error && (
            <Alert
              type="error"
              message={error}
              showIcon
              action={!settings && <Button onClick={() => void load()}>重试</Button>}
            />
          )}
          {notice && <Alert type="success" message={notice} showIcon />}
          {loading ? (
            <Spin aria-label="正在加载配置" />
          ) : (
            settings && (
              <>
                <div>
                  <Typography.Text strong>当前状态 </Typography.Text>
                  <Tag color={settings.hasApiKey ? 'success' : 'default'}>
                    {settings.hasApiKey ? '已配置' : '未配置'}
                  </Tag>
                </div>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  密钥保存在运行 Rill
                  后端的机器上，同一后端的创作任务共用此配置。页面不会显示已保存的密钥，保存不会调用模型。
                </Typography.Paragraph>
                <Form
                  form={form}
                  layout="vertical"
                  disabled={saving}
                  onFinish={({ apiKey }) => void update({ action: 'replace', apiKey })}
                >
                  <Form.Item
                    label={settings.hasApiKey ? '更换 API Key' : 'API Key'}
                    name="apiKey"
                    validateTrigger="onBlur"
                    rules={[
                      {
                        validator: (_, value: unknown) =>
                          ApiKeyUpdateSchema.safeParse({ action: 'replace', apiKey: value }).success
                            ? Promise.resolve()
                            : Promise.reject(
                                new Error('请输入有效的 API Key（字母、数字、点、下划线或连字符）'),
                              ),
                      },
                    ]}
                  >
                    <Input.Password
                      autoComplete="new-password"
                      placeholder="输入 DeepSeek API Key"
                      maxLength={4096}
                    />
                  </Form.Item>
                  <Space wrap>
                    <Button type="primary" htmlType="submit" loading={saving}>
                      保存 API Key
                    </Button>
                    {settings.hasApiKey && (
                      <Popconfirm
                        title="清除已保存的 API Key？"
                        description="清除后无法继续调用模型，已有小说不会删除。"
                        onConfirm={() => update({ action: 'remove' })}
                        okText="清除"
                        cancelText="取消"
                        disabled={saving}
                      >
                        <Button danger disabled={saving}>
                          清除 API Key
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                </Form>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  接口：{settings.baseUrl}
                  <br />
                  草稿模型：{settings.draftModel}
                  <br />
                  推理模型：{settings.reasoningModel}
                </Typography.Paragraph>
              </>
            )
          )}
        </Space>
      </Card>
    </div>
  );
}
