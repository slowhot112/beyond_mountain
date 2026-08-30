#!/usr/bin/env node
// 山外山 · API 黑盒冒烟脚本（工单 t/01）
// 零依赖：仅 Node 内置模块 + 全局 fetch（Node 18+）。
// 流程：spawn 起真实 server.mjs（PORT=4173）→ 轮询 readiness（≤15s）→ 逐条黑盒断言 →
//       打印 PASS/FAIL 清单 → 无论成败 kill 子进程 → 任一断言失败退出码非 0。
// 断言依据 server.mjs / zhihu.js 真实行为（非想象）：
//   - GET /api/health 无 Secret → 200 + {ok:false, code:'NO_SECRET', data:{configured:false}}（server.mjs:215）
//     有 Secret 且额度查询成功 → {ok:true, data:{configured:true, reachable:true, raw}}（走免费 quota 接口，不消耗直答配额）
//   - GET /api/hot → {ok:true, data:{mock:!SECRET, items}}；DEMO 下 items 为 3 条 mock
//   - GET /api/search?q= → 缺 q 400 MISSING_Q；否则 {ok:true, data:{mock:!SECRET, items}}
//   - POST /api/alchemy 最小合法体 {topic, persona?, queries?}（server.mjs:164-171；src/App.jsx:58-62 实际发送形状）
//     DEMO → {ok:true, data:{ok,mock:true,topic,conflict:{roles},framework,quiz[3],actions,sources}}
//   - POST /api/resume 空 text → 400 + {ok:false, code:'EMPTY_TEXT'}（server.mjs:198，在任何额度调用之前）
//   - POST /api/parse-doc（multipart 文件）→ MarkItDown 未启动/解析失败 → 200 + {ok:false, code:'DOC_PARSE_FAILED'}
//     （catch 内 sendJson 默认 200，server.mjs:190）；本机 md 服务在跑且转换成功 → {ok:true, data:{text}}
//   - 未知路径 → serveStatic 回退 dist/index.html：200 + text/html（需先 npm run build）
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const READINESS_TIMEOUT_MS = 15_000;
const READINESS_INTERVAL_MS = 300;
const REQUEST_TIMEOUT_MS = 10_000; // 单请求超时（parse-doc 等防悬挂）

let child = null;
let serverLogTail = [];

function relayServerOutput(stream) {
  if (!stream) return;
  const rl = createInterface({ input: stream });
  rl.on('line', (line) => {
    serverLogTail.push(line);
    if (serverLogTail.length > 50) serverLogTail.shift();
    console.log(`  [server] ${line}`);
  });
}

function killServer() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill(); } catch { /* 进程已退出 */ }
}
process.on('exit', killServer);
process.on('SIGINT', () => { killServer(); process.exit(1); });
process.on('SIGTERM', () => { killServer(); process.exit(1); });

// ---------- 断言记录 ----------
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function skip(name, reason) {
  results.push({ name, pass: true, skipped: true });
  console.log(`SKIP  ${name} — ${reason}`);
}

// ---------- HTTP 助手 ----------
async function fetchRaw(path, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 响应（如 SPA HTML） */ }
  return { status: res.status, contentType: res.headers.get('content-type') || '', text, json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 主流程 ----------
async function main() {
  console.log(`== 山外山 API 黑盒冒烟（t/01）==`);
  console.log(`服务: node server.mjs @ ${BASE}`);

  // 0) 预检端口：若已有进程占用 4173，测到的是别人的服务，直接判环境错误
  try {
    await fetchRaw('/', {}, 1500);
    console.error(`FATAL  端口 ${PORT} 已被占用，拒绝把断言打到未知进程上。请先释放端口后重试。`);
    process.exitCode = 1;
    return;
  } catch { /* 连不上 = 端口空闲，符合预期 */ }

  // 1) 起真实服务（注入 PORT；其余环境变量透传，是否 LIVE 由服务实际响应决定）
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(`已 spawn server.mjs（pid=${child.pid}）`);
  relayServerOutput(child.stdout);
  relayServerOutput(child.stderr);
  child.on('error', (e) => { serverLogTail.push(`spawn error: ${e.message}`); });

  let configured; // 分支标记（服务自身告知），供最后汇总行使用
  try {
    // 2) readiness 轮询（≤15s）：GET / 永远是本地静态逻辑，不依赖外部 API
    const deadline = Date.now() + READINESS_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break; // 服务提前退出
      try { await fetchRaw('/', {}, 2000); ready = true; break; } catch { await sleep(READINESS_INTERVAL_MS); }
    }
    if (!ready) {
      check('readiness: 服务在 15s 内可响应', false,
        child.exitCode !== null ? `子进程提前退出（code=${child.exitCode}）` : '超时');
      console.error('--- server 日志尾部 ---\n' + serverLogTail.map((l) => '  ' + l).join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log('readiness OK');

    // 3) 分支判定：黑盒询问服务自身（health.data.configured）
    const health = await fetchRaw('/api/health');
    configured = health.json?.data?.configured;
    if (configured === false) {
      console.log('模式: DEMO（无 Secret，走演示数据断言集 a-g）');
      await runDemoSuite(health);
    } else if (configured === true) {
      console.log('模式: LIVE（检测到 Secret，只打不消耗额度的端点，绝不调 alchemy/search）');
      await runLiveSuite(health);
    } else {
      check('/api/health 返回可判定分支的信封', false,
        `status=${health.status} body=${health.text.slice(0, 200)}`);
    }
  } catch (e) {
    check('冒烟流程未崩溃', false, String(e?.message || e));
  } finally {
    killServer();
  }

  // 4) 汇总
  const fails = results.filter((r) => !r.pass);
  const skips = results.filter((r) => r.skipped).length;
  console.log(`== 结果：${results.length - fails.length - skips} 通过 / ${fails.length} 失败 / ${skips} 跳过（模式 ${configured === true ? 'LIVE' : configured === false ? 'DEMO' : '未知'}）==`);
  process.exitCode = fails.length ? 1 : 0;
}

// ---------- DEMO 断言集（无 Secret）----------
async function runDemoSuite(health) {
  // a) health 无 Secret 形态（与 server.mjs:215 一致）
  check('a) /api/health 无 Secret → 200 + {ok:false, code:NO_SECRET, data.configured:false}',
    health.status === 200 && health.json?.ok === false && health.json?.code === 'NO_SECRET'
      && health.json?.data?.configured === false,
    `status=${health.status} body=${JSON.stringify(health.json)}`);

  // b) hot：ok:true、items≥1、mock:true（只断结构与信封，不断 mock 文案）
  const hot = await fetchRaw('/api/hot');
  check('b) /api/hot → ok:true, data.mock:true, items≥1',
    hot.status === 200 && hot.json?.ok === true && hot.json?.data?.mock === true
      && Array.isArray(hot.json?.data?.items) && hot.json.data.items.length >= 1,
    `status=${hot.status} items=${hot.json?.data?.items?.length}`);

  // c) search（常见词）：ok:true、items≥1
  const search = await fetchRaw('/api/search?q=' + encodeURIComponent('AI'));
  check('c) /api/search?q=AI → ok:true, items≥1',
    search.status === 200 && search.json?.ok === true
      && Array.isArray(search.json?.data?.items) && search.json.data.items.length >= 1,
    `status=${search.status} items=${search.json?.data?.items?.length}`);

  // d) alchemy：完整四模块演示数据（冲突对峙/信谁框架/判断力自测/行动地图）
  const body = JSON.stringify({
    topic: 'AI 会取代初级程序员吗',
    persona: { identity: 'pre', industry: 'ai', sub: 'AIGC' },
    queries: ['AI 编程 初级程序员', 'AI 编程 学习路线'], // 前端实际发送形状（server 当前仅转发 topic/persona）
  });
  const alchemy = await fetchRaw('/api/alchemy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  }, 20_000);
  const d = alchemy.json?.data;
  const roles = d?.conflict?.roles;
  const quiz = d?.quiz;
  const actions = d?.actions;
  check('d) /api/alchemy → ok:true + 四模块齐全（conflict.roles≥2 / quiz===3 / actions 非空 / framework 存在）',
    alchemy.status === 200 && alchemy.json?.ok === true
      && Array.isArray(roles) && roles.length >= 2
      && Array.isArray(quiz) && quiz.length === 3
      && Array.isArray(actions) && actions.length >= 1
      && d?.framework && typeof d.framework === 'object',
    `status=${alchemy.status} roles=${Array.isArray(roles) ? roles.length : 'n/a'} `
      + `quiz=${Array.isArray(quiz) ? quiz.length : 'n/a'} actions=${Array.isArray(actions) ? actions.length : 'n/a'}`);

  // e) resume 空文本 → 400 + EMPTY_TEXT
  const resume = await fetchRaw('/api/resume', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '   ' }),
  });
  check('e) /api/resume 空文本 → 400 + {ok:false, code:EMPTY_TEXT}',
    resume.status === 400 && resume.json?.ok === false && resume.json?.code === 'EMPTY_TEXT',
    `status=${resume.status} body=${JSON.stringify(resume.json)}`);

  // f) parse-doc（multipart 小文件，防悬挂 10s）：
  //    MarkItDown 未启动/解析失败 → 200 + DOC_PARSE_FAILED；本机 md 在跑且转换成功 → ok:true 也算通过
  const boundary = '----smoke' + Date.now().toString(36);
  const fileContent = 'smoke test file for parse-doc\n';
  const multipart = '--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="file"; filename="smoke.txt"\r\n'
    + 'Content-Type: text/plain\r\n\r\n' + fileContent + '\r\n--' + boundary + '--\r\n';
  let parseDoc;
  let parseErr = '';
  try {
    parseDoc = await fetchRaw('/api/parse-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: multipart,
    }, 10_000);
  } catch (e) {
    parseErr = String(e?.name === 'TimeoutError' ? '请求悬挂超过 10s（AbortError）' : e?.message || e);
  }
  if (parseDoc) {
    const failedBranch = parseDoc.json?.ok === false && parseDoc.json?.code === 'DOC_PARSE_FAILED';
    const okBranch = parseDoc.json?.ok === true && typeof parseDoc.json?.data?.text === 'string';
    check('f) /api/parse-doc → 合法信封、不崩溃不悬挂（DOC_PARSE_FAILED 或 ok:true）',
      parseDoc.status === 200 && (failedBranch || okBranch),
      failedBranch ? '命中 DOC_PARSE_FAILED 分支（MarkItDown 未启动或解析失败）'
        : okBranch ? '命中 ok:true 分支（本机 MarkItDown 服务在跑且转换成功）'
        : `status=${parseDoc.status} body=${parseDoc.text.slice(0, 200)}`);
  } else {
    check('f) /api/parse-doc → 合法信封、不崩溃不悬挂（DOC_PARSE_FAILED 或 ok:true）', false, parseErr);
  }

  // g) 未知路径 → SPA 回退 200 + HTML（需 dist/ 已构建；未构建时服务返回 404 提示）
  const spa = await fetchRaw('/definitely-not-exist');
  check('g) 未知路径 /definitely-not-exist → 200 + text/html（SPA 回退 dist/index.html）',
    spa.status === 200 && spa.contentType.includes('text/html') && /<html/i.test(spa.text),
    spa.status === 404
      ? 'status=404：dist/index.html 不存在，请先 npm run build'
      : `status=${spa.status} contentType=${spa.contentType}`);
}

// ---------- LIVE 断言集（有 Secret：只打不消耗额度的端点）----------
async function runLiveSuite(health) {
  // health：reachable 且带额度详情（额度查询走免费 quota 接口，消耗为 0）
  check('L-a) /api/health → ok:true, configured:true, reachable:true, raw 额度详情存在',
    health.status === 200 && health.json?.ok === true
      && health.json?.data?.configured === true && health.json?.data?.reachable === true
      && health.json?.data?.raw !== undefined,
    `status=${health.status} raw=${JSON.stringify(health.json?.data?.raw)?.slice(0, 200)}`);

  // 本地-only 端点（代码路径不触碰知乎 API，零额度消耗）：
  const resume = await fetchRaw('/api/resume', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '' }),
  });
  check('L-b) /api/resume 空文本 → 400 + EMPTY_TEXT（本地校验，不调知乎 API）',
    resume.status === 400 && resume.json?.ok === false && resume.json?.code === 'EMPTY_TEXT',
    `status=${resume.status}`);

  const spa = await fetchRaw('/definitely-not-exist');
  check('L-c) 未知路径 → 200 + text/html（SPA 回退，静态本地）',
    spa.status === 200 && spa.contentType.includes('text/html') && /<html/i.test(spa.text),
    `status=${spa.status} contentType=${spa.contentType}`);

  // 消耗额度的端点一律 SKIP（按工单要求，非弱化断言）
  skip('/api/hot（DEMO 断言）', 'LIVE 模式下跳过：热榜消耗 100 次/天额度');
  skip('/api/search（DEMO 断言）', 'LIVE 模式下跳过：搜索消耗额度');
  skip('/api/alchemy（DEMO 断言）', 'LIVE 模式下跳过：直答消耗 100 次/天额度');
}

main().catch((e) => {
  console.error('FATAL  冒烟脚本自身异常:', e?.stack || e);
  killServer();
  process.exitCode = 1;
});
