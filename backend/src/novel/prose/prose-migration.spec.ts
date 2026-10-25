import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

it('正文迁移适用于空库与旧项目，保留旧数据并约束章节唯一与级联清理', () => {
  const directory = fileURLToPath(new URL('../../../prisma/migrations/', import.meta.url));
  const names = readdirSync(directory, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const existing of [false, true]) {
    const db = new DatabaseSync(':memory:');
    try {
      for (const name of names.filter((n) => n !== '20261022140000_add_prose'))
        db.exec(readFileSync(join(directory, name, 'migration.sql'), 'utf8'));
      if (existing)
        db.exec(
          "INSERT INTO Project (id,title,genre,length,currentStage,updatedAt) VALUES ('old','旧书','dushi','short','beats',CURRENT_TIMESTAMP)",
        );
      db.exec(readFileSync(join(directory, '20261022140000_add_prose/migration.sql'), 'utf8'));
      if (existing)
        expect(
          db.prepare("SELECT title,currentStage FROM Project WHERE id='old'").get(),
        ).toMatchObject({ title: '旧书', currentStage: 'beats' });
      else
        db.exec(
          "INSERT INTO Project (id,title,genre,length,currentStage,updatedAt) VALUES ('old','新书','dushi','short','prose',CURRENT_TIMESTAMP)",
        );
      db.exec(
        "INSERT INTO ProseBook (id,projectId,targetChapters) VALUES ('book','old',3); INSERT INTO ProseChapter (id,bookId,chapterNumber,relativePath) VALUES ('chapter','book',1,'chapters/001.md')",
      );
      expect(() =>
        db.exec(
          "INSERT INTO ProseChapter (id,bookId,chapterNumber,relativePath) VALUES ('duplicate','book',1,'chapters/001.md')",
        ),
      ).toThrow();
      db.exec("DELETE FROM Project WHERE id='old'");
      expect(db.prepare('SELECT COUNT(*) AS n FROM ProseChapter').get()).toMatchObject({ n: 0 });
    } finally {
      db.close();
    }
  }
});
