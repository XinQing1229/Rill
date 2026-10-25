import { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space } from 'antd';
import { BookCopyModeSchema, type BookCopyMode } from '@rill/shared';
import { copyBookChapter } from '../../api/book-export';
const key = 'rill.book-copy-mode';
const options = [
  { value: 'plain-with-title', label: '带标题纯文本' },
  { value: 'plain-body', label: '仅正文' },
  { value: 'markdown-source', label: 'Markdown 原文' },
];
export function ChapterCopy({
  projectId,
  chapterNumber,
  disabled = false,
}: {
  projectId: string;
  chapterNumber: number;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<BookCopyMode>(() => {
    try {
      const parsed = BookCopyModeSchema.safeParse(localStorage.getItem(key));
      return parsed.success ? parsed.data : 'plain-with-title';
    } catch {
      return 'plain-with-title';
    }
  });
  useEffect(() => {
    const sync = () => {
      try {
        const parsed = BookCopyModeSchema.safeParse(localStorage.getItem(key));
        if (parsed.success) setMode(parsed.data);
      } catch {
        /* 保留当前偏好。 */
      }
    };
    window.addEventListener('rill-copy-mode', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('rill-copy-mode', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  return (
    <div>
      <Space wrap>
        <Select
          aria-label="复制格式"
          value={mode}
          options={options}
          onChange={(v) => {
            setMode(v);
            setDone(false);
            try {
              localStorage.setItem(key, v);
              window.dispatchEvent(new Event('rill-copy-mode'));
            } catch {
              /* 无存储权限时保留本次选择。 */
            }
          }}
          disabled={busy}
          style={{ width: 160 }}
        />
        <Button
          loading={busy}
          disabled={disabled}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError('');
            setDone(false);
            try {
              const result = await copyBookChapter(projectId, chapterNumber, mode);
              try {
                await navigator.clipboard.writeText(result.text);
                setDone(true);
              } catch {
                setFallback(result.text);
                setError('剪贴板不可用，请手动复制下方内容');
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : '复制失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          复制本章
        </Button>
        {done && <span role="status">已复制</span>}
      </Space>
      {error && <Alert type="warning" showIcon message={error} style={{ marginTop: 8 }} />}
      <Modal
        title="手动复制本章"
        open={fallback !== null}
        onCancel={() => setFallback(null)}
        footer={<Button onClick={() => setFallback(null)}>关闭</Button>}
      >
        <Input.TextArea
          aria-label="可手动复制的正文"
          readOnly
          value={fallback ?? ''}
          rows={14}
          onFocus={(e) => e.target.select()}
        />
      </Modal>
    </div>
  );
}
