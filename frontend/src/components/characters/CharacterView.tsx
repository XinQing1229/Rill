import type { Character, CharacterRow } from '@rill/shared';
import { CharacterSchema } from '@rill/shared';
import { Alert } from 'antd';

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
    <div className={`who${lead ? ' lead' : ''}`}>
      <header>
        <h3>{row.name}</h3>
        <span className="role">
          {ROLE_LABELS[row.role] ?? row.role}
          {lead && row.role !== 'protagonist' ? ' · 主角' : ''}
        </span>
      </header>
      {parseError !== null && (
        <Alert type="warning" showIcon message={parseError} style={{ marginBottom: 8 }} />
      )}
      {character !== null && (
        <dl className="kv wide-lead">
          <dt>身份</dt>
          <dd>{character.identity}</dd>
          <dt>渴望</dt>
          <dd>{character.desire}</dd>
          <dt>缺陷</dt>
          <dd>{character.flaw}</dd>
          <dt>性格</dt>
          <dd>{character.personality}</dd>
          <dt>背景</dt>
          <dd>{character.background}</dd>
          <dt>能力</dt>
          <dd>{character.abilities}</dd>
          <dt className="wide">弧线</dt>
          <dd className="wide">{character.arc}</dd>
        </dl>
      )}
    </div>
  );
}

/** 人物产物：卡片列表，主角（第一行）置顶带标识 */
export function CharacterView({ rows }: { rows: CharacterRow[] }) {
  return (
    <div className="cast">
      {rows.map((row, index) => (
        <CharacterCard key={row.id} row={row} lead={index === 0} />
      ))}
    </div>
  );
}
