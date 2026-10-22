import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * 测试数据库准备（jest globalSetup）：
 * 使用独立的 SQLite 文件，并通过迁移创建表结构，避免污染开发数据。
 *
 * 注意：jest 始终以 CommonJS 方式加载 globalSetup（@jest/core 的
 * requireAndTranspileModule），因此此处可用 __dirname，而不能用 import.meta。
 * 测试文件本身以 ESM 加载，那里必须用 import.meta.url。
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
