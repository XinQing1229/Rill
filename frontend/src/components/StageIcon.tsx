import {
  ApartmentOutlined,
  BookOutlined,
  FileTextOutlined,
  GlobalOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { Stage } from '@rill/shared';

/** 阶段图标只作视觉辅助，名称由相邻文字提供。 */
export function StageIcon({ stage }: { stage: Stage }) {
  const icons = {
    premise: (
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M12 14C8 6 15 3 21 3c0 7-2 12-9 11Z"
          fill="#b1e6b9"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M11 15C5 16 3 12 3 8c5 0 9 1 8 7Z"
          fill="#d5efb3"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M11 21v-6l6-7M11 15l-4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
    world: <GlobalOutlined />,
    characters: <UserOutlined />,
    relations: <ApartmentOutlined />,
    outline: <FileTextOutlined />,
    prose: <BookOutlined />,
  };
  return (
    <span className={`stage-icon stage-icon-${stage}`} aria-hidden="true">
      {icons[stage]}
    </span>
  );
}
