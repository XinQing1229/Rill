import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

it('阶段运行迁移保留既有项目与产物，并可保存空产物阶段的执行结果', () => {
  const db = new DatabaseSync(':memory:');
  const migration = (name: string) =>
    readFileSync(
      new URL(`../../../prisma/migrations/${name}/migration.sql`, import.meta.url),
      'utf8',
    );
  try {
    db.exec(migration('20261021170625_init'));
    db.exec(migration('20261021182821_world_characters_relations'));
    db.exec(`INSERT INTO Project (id,title,genre,length,currentStage,updatedAt) VALUES ('old','旧小说','xuanhuan','short','premise',CURRENT_TIMESTAMP);
      INSERT INTO Premise (id,projectId,data,status,updatedAt) VALUES ('seed','old','{"title":"保留原文"}','done',CURRENT_TIMESTAMP);`);
    db.exec(migration('20261022052517_add_stage_run'));
    db.exec(migration('20261022053132_stage_run_stale'));
    expect(db.prepare('SELECT title,runId FROM Project').get()).toMatchObject({
      title: '旧小说',
      runId: null,
    });
    expect(db.prepare('SELECT data FROM Premise').get()).toMatchObject({
      data: '{"title":"保留原文"}',
    });
    db.exec(
      `INSERT INTO StageRun (id,projectId,runId,stage,status,updatedAt) VALUES ('execution','old','run','relations','done',CURRENT_TIMESTAMP);`,
    );
    expect(db.prepare('SELECT stage,status,stale FROM StageRun').get()).toMatchObject({
      stage: 'relations',
      status: 'done',
      stale: 0,
    });
  } finally {
    db.close();
  }
});
