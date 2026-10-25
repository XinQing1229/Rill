import { setTimeout as delay } from 'node:timers/promises';

const healthUrl = 'http://localhost:3000/api/health';
const deadline = Date.now() + 120_000;
let ready = false;

console.log('正在等待后端就绪，成功后将启动前端并打开浏览器…');
while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    });
    if (response.ok && (await response.json()).status === 'ok') {
      ready = true;
      break;
    }
  } catch {
    // 编译、连接数据库期间尚未监听端口，继续等待。
  }
  await delay(300);
}

if (ready) {
  console.log('后端已就绪，正在启动前端。');
} else {
  console.error(`等待后端超时（120 秒）：${healthUrl}，请检查后端启动日志。`);
  process.exitCode = 1;
}
