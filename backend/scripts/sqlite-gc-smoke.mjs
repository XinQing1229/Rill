import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompress } from 'node:zlib';
import Database from 'better-sqlite3';

// 在独立 Node 进程的原生异步回调中回收短生命周期 Statement。
// 曾在 Node 24 的此类回调中触发 RemoveEnvironmentCleanupHook 断言，
// 普通 SQL 功能断言无法发现这种导致整个服务退出的故障。
assert.equal(typeof global.gc, 'function', '请使用 node --expose-gc 运行');
const directory = mkdtempSync(join(tmpdir(), 'rill-sqlite-gc-'));
const file = join(directory, 'test.db');
const context = new AsyncLocalStorage();
const compressed = brotliCompressSync(Buffer.from('rill-sqlite-gc'));
let database = new Database(file);
try {
  database.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  await context.run({ projectId: 'gc-regression' }, async () => {
    for (let round = 0; round < 50; round++) {
      for (let index = 0; index < 200; index++) {
        database.prepare('INSERT INTO entries (value) VALUES (?)').run(`${round}:${index}`);
        assert.equal(
          database.prepare('SELECT count(*) AS count FROM entries').get().count,
          round * 200 + index + 1,
        );
      }
      await new Promise((resolve, reject) => {
        brotliDecompress(compressed, (error, result) => {
          if (error) return reject(error);
          try {
            assert.equal(result.toString(), 'rill-sqlite-gc');
            assert.equal(context.getStore().projectId, 'gc-regression');
            global.gc();
            resolve();
          } catch (failure) {
            reject(failure);
          }
        });
      });
    }
  });
  database.close();
  database = new Database(file);
  assert.equal(database.prepare('SELECT count(*) AS count FROM entries').get().count, 10000);
  console.log('SQLite GC 回归通过：10000 次写入、50 次原生回调 GC、重开数据库校验成功');
} finally {
  database.close();
  rmSync(directory, { recursive: true, force: true });
}
