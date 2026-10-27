import type { Character, CharacterRow } from '@rill/shared';
import { CharacterSchema } from '@rill/shared';
import { Alert } from 'antd';
import {
  BarChartOutlined,
  BulbOutlined,
  FileTextOutlined,
  RiseOutlined,
  TrophyOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import './CharacterView.css';

const ROLE_LABELS: Record<string, string> = {
  protagonist: '主角',
  supporting: '配角',
  antagonist: '反派',
};

function CharacterCard({ row, lead }: { row: CharacterRow; lead: boolean }) {
  let character: Character | null = null;
  let parseError: string | null = null;
  try {
    const parsed = CharacterSchema.safeParse(JSON.parse(row.data));
    if (parsed.success) {
      character = parsed.data;
    } else {
      parseError = '人物数据结构异常，仅展示基础信息';
    }
  } catch {
    parseError = '人物数据不是合法 JSON，仅展示基础信息';
  }

  return (
    <article className={`character-card who${lead ? ' lead' : ''}`} aria-label={row.name}>
      <header className="character-overview">
        <div className="character-intro">
          <div className="character-name-row">
            <h3>{row.name}</h3>
            <span className="character-role">
              {ROLE_LABELS[row.role] ?? row.role}
              {lead && row.role !== 'protagonist' ? ' · 主角' : ''}
            </span>
          </div>
          {character && <p>{character.identity}</p>}
        </div>
        {character && (
          <blockquote className="character-quote">
            <span aria-hidden="true">“</span>
            <p>{character.identity}</p>
          </blockquote>
        )}
      </header>
      {parseError !== null && (
        <Alert type="warning" showIcon message={parseError} style={{ marginBottom: 8 }} />
      )}
      {character !== null && (
        <dl className="character-fields">
          {[
            { key: 'identity', label: '身份', icon: <UserOutlined />, tone: 'slate' },
            { key: 'desire', label: '渴望', icon: <TrophyOutlined />, tone: 'green' },
            { key: 'flaw', label: '缺陷', icon: <WarningOutlined />, tone: 'coral' },
            { key: 'personality', label: '性格', icon: <BulbOutlined />, tone: 'purple' },
            { key: 'background', label: '背景', icon: <FileTextOutlined />, tone: 'amber' },
            { key: 'abilities', label: '能力', icon: <BarChartOutlined />, tone: 'blue' },
            { key: 'arc', label: '弧线', icon: <RiseOutlined />, tone: 'purple' },
          ].map(({ key, label, icon, tone }) => (
            <div key={key} className={`character-field character-field-${key}`}>
              <dt>
                <span className={`character-field-icon character-tone-${tone}`} aria-hidden="true">
                  {icon}
                </span>
                {label}
              </dt>
              <dd>{character[key as keyof Character]}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

/** 人物产物：卡片列表，主角（第一行）置顶带标识 */
export function CharacterView({ rows }: { rows: CharacterRow[] }) {
  return (
    <div className="character-view">
      {rows.map((row, index) => (
        <CharacterCard key={row.id} row={row} lead={index === 0} />
      ))}
    </div>
  );
}
