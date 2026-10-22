import type { ThemeConfig } from 'antd';

/** 设计 token：与 index.css 的 CSS 变量一致（视觉基准见 .taste-skill 原型） */
export const tokens = {
  ground: '#f9fbfc',
  surface: '#ffffff',
  raised: '#f4f6f8',
  active: '#ebedee',
  border: '#e8eaec',
  rule: '#f0f1f2',
  control: '#cdced1',
  text: '#131416',
  muted: '#5d5f60',
  faint: '#6b6b6b',
  primary: '#1d1f20',
  primaryInk: '#ffffff',
  accent: '#1b6c80',
  positive: '#1e7b4f',
  negative: '#c4242a',
  warning: '#92400e',
} as const;

/** 把设计 token 映射到 AntD theme，避免默认蓝渗透（tasks 1.2） */
export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: tokens.primary,
    colorInfo: tokens.accent,
    colorLink: tokens.text,
    colorTextBase: tokens.text,
    colorText: tokens.text,
    colorTextSecondary: tokens.muted,
    colorTextTertiary: tokens.faint,
    colorBorder: tokens.control,
    colorBorderSecondary: tokens.border,
    colorBgLayout: tokens.ground,
    colorBgContainer: tokens.surface,
    colorBgElevated: tokens.surface,
    colorSuccess: tokens.positive,
    colorError: tokens.negative,
    colorWarning: tokens.warning,
    borderRadius: 6,
    fontSize: 14,
    fontFamily:
      "'IBM Plex Sans', -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  },
  components: {
    Table: {
      headerBg: 'transparent',
      rowHoverBg: tokens.raised,
      headerColor: tokens.muted,
    },
  },
};
