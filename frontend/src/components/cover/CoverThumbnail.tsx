import { useState } from 'react';
import { BookOutlined } from '@ant-design/icons';
import { coverImageUrl } from '../../api/cover';

/** 图片异常时回到可辨认的占位；换图后允许重新加载。 */
export function CoverThumbnail({
  projectId,
  assetId,
  alt,
}: {
  projectId: string;
  assetId?: string;
  alt: string;
}) {
  const [failedId, setFailedId] = useState<string | null>(null);
  return assetId && failedId !== assetId ? (
    <img
      loading="lazy"
      src={coverImageUrl(projectId, assetId, true)}
      alt={alt}
      onError={() => setFailedId(assetId)}
    />
  ) : (
    <BookOutlined aria-hidden="true" />
  );
}
