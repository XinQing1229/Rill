import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * 测试数据库准备（jest globalSetup）：
 * 使用独立的 SQLite 文件，并通过迁移创建表结构，避免污染开发数据。
 */
export default function setup(): void {
  const backendDir = join(__dirname, '..');
  const dbPath = join(backendDir, 'pipeline-test.db');
  const url = `file:${dbPath}`;

  process.env.DATABASE_URL = url;

  execSync('./node_modules/.bin/prisma migrate deploy', {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });
}
