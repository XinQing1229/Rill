import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Collapse,
  Form,
  Input,
  Popconfirm,
  Radio,
  Space,
  Spin,
  Typography,
  type FormInstance,
} from 'antd';
import { ApiOutlined, DeploymentUnitOutlined } from '@ant-design/icons';
import {
  ApiKeySettingsSchema,
  ApiKeyUpdateSchema,
  MODEL_DISPLAY_NAME,
  type ApiKeySettings,
  type ApiKeyUpdate,
  type ModelProvider,
} from '@rill/shared';
import { get, pingLlm, post } from '../api/client';
import { useModelSettings } from '../contexts/ModelSettingsContext';

const PROVIDER_LABEL: Record<ModelProvider, string> = {
  deepseek: 'DeepSeek',
  glm: '智谱 GLM',
};

const MODEL_LABEL = MODEL_DISPLAY_NAME;

const PROVIDER_ICON: Record<ModelProvider, ReactNode> = {
  deepseek: <DeploymentUnitOutlined />,
  glm: <ApiOutlined />,
};

function ProviderIcon({ provider }: { provider: ModelProvider }) {
  return (
    <Avatar
      size={34}
      icon={PROVIDER_ICON[provider]}
      style={{ backgroundColor: '#f0f0f0', color: '#595959', flex: 'none' }}
    />
  );
}

export function ApiKeySettingsPage() {
  const { setActiveModel } = useModelSettings();
  const [deepseekForm] = Form.useForm<{ apiKey: string }>();
  const [glmForm] = Form.useForm<{ apiKey: string }>();
  const [settings, setSettings] = useState<ApiKeySettings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<
    { ok: true; model: string; content: string } | { ok: false; message: string } | null
  >(null);
  const pending = useRef(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setSettings(ApiKeySettingsSchema.parse(await get('/api/llm/settings')));
    } catch {
      setError('无法读取模型设置，请检查后端服务后重试');
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
    setPingResult(null);
    try {
      const result = ApiKeySettingsSchema.parse(await post('/api/llm/settings', value));
      setSettings(result);
      setActiveModel(MODEL_DISPLAY_NAME[result.activeProvider]);
      if (value.action === 'replace-key') {
        (value.provider === 'glm' ? glmForm : deepseekForm).setFieldsValue({ apiKey: '' });
        setNotice(`${PROVIDER_LABEL[value.provider]} API Key 已保存`);
      } else if (value.action === 'remove-key') {
        setNotice(`${PROVIDER_LABEL[value.provider]} 用户 Key 已清除`);
      } else {
        setNotice(`已切换到 ${PROVIDER_LABEL[value.provider]}`);
      }
    } catch {
      setError('保存失败，输入已保留，请检查服务后重试');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const keyPanel = (provider: ModelProvider, form: FormInstance<{ apiKey: string }>) => {
    if (!settings) return null;
    const providerSettings = settings.providers[provider];
    const sourceLabel = {
      user: '用户 Key',
      env: '.env',
      none: '未配置',
    }[providerSettings.keySource];

    return {
      key: provider,
      label: (
        <Space size={12}>
          <ProviderIcon provider={provider} />
          <span>
            <Typography.Text strong>{MODEL_LABEL[provider]}</Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {sourceLabel}
            </Typography.Text>
          </span>
        </Space>
      ),
      children: (
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            用户 Key 加密保存在本地，优先于同服务商的 .env Key。
          </Typography.Text>
          <Form
            form={form}
            layout="vertical"
            disabled={saving}
            onFinish={({ apiKey }) => void update({ action: 'replace-key', provider, apiKey })}
          >
            <Form.Item
              label={providerSettings.hasUserKey ? '更换 API Key' : '添加 API Key'}
              name="apiKey"
              validateTrigger="onBlur"
              rules={[
                {
                  validator: (_, value: unknown) =>
                    ApiKeyUpdateSchema.safeParse({
                      action: 'replace-key',
                      provider,
                      apiKey: value,
                    }).success
                      ? Promise.resolve()
                      : Promise.reject(new Error('请输入有效的 API Key')),
                },
              ]}
            >
              <Input.Password
                aria-label={`${providerSettings.hasUserKey ? '更换' : '添加'} ${PROVIDER_LABEL[provider]} API Key`}
                autoComplete="new-password"
                placeholder="粘贴 API Key"
                maxLength={4096}
              />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                保存
              </Button>
              {providerSettings.hasUserKey && (
                <Popconfirm
                  title={`清除 ${PROVIDER_LABEL[provider]} 用户 Key？`}
                  description="清除后会回退到 .env Key（如果已配置）。"
                  onConfirm={() => void update({ action: 'remove-key', provider })}
                  okText="清除"
                  cancelText="取消"
                  disabled={saving}
                >
                  <Button danger disabled={saving}>
                    清除
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </Form>
        </Space>
      ),
    };
  };

  const testCurrentModel = async () => {
    if (pinging) return;
    setPinging(true);
    setPingResult(null);
    try {
      const result = await pingLlm();
      setPingResult({ ok: true, model: result.model, content: result.content });
    } catch (cause) {
      setPingResult({
        ok: false,
        message:
          cause instanceof DOMException && cause.name === 'TimeoutError'
            ? '测试连接超时，请检查后端服务和网络后重试'
            : cause instanceof Error
              ? cause.message
              : '模型调用失败，请检查配置后重试',
      });
    } finally {
      setPinging(false);
    }
  };

  return (
    <div className="page">
      <div className="title-row">
        <div>
          <h1>模型设置</h1>
        </div>
      </div>
      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          action={!settings && <Button onClick={() => void load()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      )}
      {notice && <Alert type="success" message={notice} showIcon style={{ marginBottom: 16 }} />}
      {loading ? (
        <Spin aria-label="正在加载模型设置" />
      ) : (
        settings && (
          <div style={{ width: '100%', maxWidth: 680 }}>
            <Typography.Text strong>选择模型</Typography.Text>
            <Radio.Group
              aria-label="选择模型"
              value={settings.activeProvider}
              disabled={saving}
              onChange={(event) => {
                const provider = event.target.value as ModelProvider;
                void update({
                  action: 'select-model',
                  provider,
                  model: settings.providers[provider].model,
                });
              }}
              style={{ display: 'flex', gap: 12, marginTop: 12 }}
            >
              {(['deepseek', 'glm'] as const).map((provider) => (
                <Radio.Button
                  key={provider}
                  value={provider}
                  style={{
                    flex: 1,
                    height: 'auto',
                    padding: '14px 16px',
                    borderRadius: 8,
                    borderInlineStartWidth: 1,
                  }}
                >
                  <Space size={12}>
                    <ProviderIcon provider={provider} />
                    <Typography.Text strong>{MODEL_LABEL[provider]}</Typography.Text>
                  </Space>
                </Radio.Button>
              ))}
            </Radio.Group>
            <Space wrap style={{ marginTop: 12 }}>
              <Button loading={pinging} disabled={saving} onClick={() => void testCurrentModel()}>
                测试连接
              </Button>
              <Typography.Text type="secondary">选择后立即用于新调用</Typography.Text>
            </Space>
            {pingResult && (
              <Alert
                style={{ marginTop: 12 }}
                type={pingResult.ok ? 'success' : 'error'}
                message={
                  pingResult.ok
                    ? `连接成功 · ${MODEL_LABEL[settings.activeProvider]}`
                    : pingResult.message
                }
                description={pingResult.ok ? pingResult.content : undefined}
                showIcon
              />
            )}

            <div style={{ marginTop: 32 }}>
              <Typography.Text strong>API Key</Typography.Text>
              <Collapse
                style={{ marginTop: 12 }}
                items={[keyPanel('deepseek', deepseekForm), keyPanel('glm', glmForm)].filter(
                  (item): item is NonNullable<typeof item> => item !== null,
                )}
              />
            </div>
          </div>
        )
      )}
    </div>
  );
}
