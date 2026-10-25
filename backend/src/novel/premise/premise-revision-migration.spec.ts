import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

it('候选迁移保留旧种子，项目内请求唯一，永久删除级联清理', () => {
  const db = new DatabaseSync(':memory:');
  const migration = (name: string) =>
    readFileSync(
      new URL(`../../../prisma/migrations/${name}/migration.sql`, import.meta.url),
      'utf8',
    );
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(migration('20261021170625_init'));
    db.exec(`INSERT INTO Project (id,title,genre,length,currentStage,updatedAt) VALUES ('p','旧小说','dushi','short','premise',CURRENT_TIMESTAMP);
      INSERT INTO Premise (id,projectId,data,status,updatedAt) VALUES ('s','p','{"title":"原文"}','done',CURRENT_TIMESTAMP);`);
    db.exec(migration('20261023020000_add_premise_revision'));
    expect(db.prepare('SELECT data FROM Premise').get()).toMatchObject({
      data: '{"title":"原文"}',
    });
    const insert = db.prepare(
      `INSERT INTO PremiseRevision (id,projectId,requestId,feedback,baseHash,runId,originalStatus,updatedAt) VALUES (?, 'p','req','建议','hash','run','idle',CURRENT_TIMESTAMP)`,
    );
    insert.run('one');
    expect(() => insert.run('two')).toThrow();
    db.exec("DELETE FROM Project WHERE id = 'p'");
    expect(db.prepare('SELECT count(*) as count FROM PremiseRevision').get()).toMatchObject({
      count: 0,
    });
  } finally {
    db.close();
  }
});

it('摘要迁移为历史候选补 null，保留候选和采用凭据', () => {
  const db = new DatabaseSync(':memory:');
  const migration = (name: string) =>
    readFileSync(
      new URL(`../../../prisma/migrations/${name}/migration.sql`, import.meta.url),
      'utf8',
    );
  try {
    db.exec(migration('20261021170625_init'));
    db.exec(migration('20261023020000_add_premise_revision'));
    db.exec(`INSERT INTO Project (id,title,genre,length,currentStage,updatedAt) VALUES ('p','作品','dushi','short','premise',CURRENT_TIMESTAMP);
      INSERT INTO PremiseRevision (id,projectId,requestId,feedback,baseHash,runId,originalStatus,data,adoptedAt,updatedAt) VALUES ('c','p','r','建议','hash','run','idle','{"title":"旧候选"}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`);
    db.exec(migration('20261023030000_add_premise_change_summary'));
    expect(
      db.prepare('SELECT data, changeSummaryData, adoptedAt FROM PremiseRevision').get(),
    ).toMatchObject({
      data: '{"title":"旧候选"}',
      changeSummaryData: null,
      adoptedAt: expect.any(String),
    });
  } finally {
    db.close();
  }
});
