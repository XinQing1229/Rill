import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

it('大纲增量迁移适用于旧数据与空库，不修改既有内容', () => {
  for (const withData of [false, true]) {
    const db = new DatabaseSync(':memory:');
    const migration = (name: string) =>
      readFileSync(
        new URL(`../../../prisma/migrations/${name}/migration.sql`, import.meta.url),
        'utf8',
      );
    try {
      for (const name of [
        '20261021170625_init',
        '20261021182821_world_characters_relations',
        '20261022052517_add_stage_run',
        '20261022053132_stage_run_stale',
      ])
        db.exec(migration(name));
      if (withData)
        db.exec(
          `INSERT INTO Project (id,title,genre,length,currentStage,status,updatedAt) VALUES ('old','原书名','dushi','long','outline','failed',CURRENT_TIMESTAMP); INSERT INTO Premise (id,projectId,data,status,updatedAt) VALUES ('seed','old','{"title":"保留原文"}','done',CURRENT_TIMESTAMP);`,
        );
      db.exec(migration('20261022070000_add_outline'));
      expect(db.prepare('SELECT COUNT(*) AS n FROM Outline').get()).toMatchObject({ n: 0 });
      if (withData) {
        expect(db.prepare('SELECT title,currentStage FROM Project').get()).toMatchObject({
          title: '原书名',
          currentStage: 'outline',
        });
        expect(db.prepare('SELECT data FROM Premise').get()).toMatchObject({
          data: '{"title":"保留原文"}',
        });
      }
    } finally {
      db.close();
    }
  }
});
