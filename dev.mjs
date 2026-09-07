// 山外山 · 一键开发启动
// 同时拉起两个进程：
//   ① 后端 API  node server.mjs（默认 3000，托管 dist 静态 + /api 代理）
//   ② 前端热更新 vite（默认 5173）
// 用法：npm run dev
// 若 3000 已被占用（比如正在跑另一份服务），后端会自动换到空闲端口，
// 并把 vite 的 /api 代理自动指向新端口，开箱即用、不用手动配。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_PORT = Number(process.env.PORT || 3000);
const WEB_PORT = Number(process.env.WEB_PORT || 5173);

// 检查某个端口当前是否空闲（与 server.mjs 的 server.listen(PORT) 同法：不指定 host）
function isFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', () => resolve(false));
    srv.listen(port, () => { srv.close(() => resolve(true)); });
  });
}

const children = [];
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) { try { c.kill(); } catch {} }
  setTimeout(() => process.exit(code), 400).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => { for (const c of children) { try { c.kill(); } catch {} } });

function start(name, args, env) {
  const child = spawn(process.execPath, args, { cwd: __dirname, stdio: 'inherit', env: { ...process.env, ...env } });
  children.push(child);
  child.on('exit', (code) => {
    if (stopping) return;
    console.log(`\n[${name}] 进程退出(code=${code})，正在关闭另一侧…`);
    shutdown(code || 0);
  });
  return child;
}

// 找后端可用的端口：用户已传 PORT 就信任它；否则避开被占用的
async function pickApiPort() {
  if (process.env.PORT) return API_PORT; // 显式指定则不绕道
  if (await isFree(API_PORT)) return API_PORT;
  for (let p = API_PORT + 1; p < API_PORT + 20; p++) {
    if (await isFree(p)) return p;
  }
  return API_PORT;
}

const apiPort = await pickApiPort();
if (apiPort !== API_PORT) {
  console.log(`提示：端口 ${API_PORT} 已被占用，后端改用 ${apiPort}（vite 代理会自动指向它）。`);
}

const viteBin = join('node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(join(__dirname, viteBin))) {
  console.error('缺少依赖：请先执行 npm install');
  process.exit(1);
}

console.log('正在启动 山外山 开发环境…');
console.log(`  后端 API  →  http://localhost:${apiPort}  （node server.mjs）`);
console.log(`  前端页面  →  http://localhost:${WEB_PORT}  （vite 热更新，Ctrl+C 一起退出）\n`);

// 后端：托管 dist（若已 build）并提供 /api
start('后端 API', ['server.mjs'], { PORT: String(apiPort) });
// 前端：vite 热更新，/api 代理指向上面那个后端端口
start('前端页面', [viteBin], {
  API_PROXY_TARGET: `http://localhost:${apiPort}`,
  PORT: String(WEB_PORT),
});
