// 知乎炼金术 · 轻量后端（Node 内置模块，零三方依赖）
// 职责：托管前端静态文件 + 代理知乎 API（Secret 仅存后端，绝不进前端）
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import * as zhihu from './zhihu.js';
import * as oauth from './oauth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const DIST = join(__dirname, 'dist'); // React 构建产物（生产模式优先）

// 读取 .env（极简实现，避免额外依赖）
function loadEnv() {
  try {
    const raw = readFileSync(join(__dirname, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();

const SECRET = process.env.ZHIHU_ACCESS_SECRET || '';
const PORT = process.env.PORT || 3000;
const TTL = Number(process.env.CACHE_TTL || 3600);
// MarkItDown 文档解析服务地址（Python 进程，可选）
const MD_SERVICE = process.env.MD_SERVICE_URL || 'http://127.0.0.1:8011';

// 调用本地 MarkItDown 服务把文档转为文本（PDF/Word/Excel/PPT/图片等）
async function parseDocViaMd(buffer, filename) {
  const FormData = (await import('node:formdata')).FormData;
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), filename);
  const r = await fetch(MD_SERVICE + '/api/convert', { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.ok) throw new Error(j.message || '文档解析失败');
  return j.text || '';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// 读取请求体 JSON（带长度上限，防止超大请求）
async function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

// 读取 multipart/form-data 中的文件（仅取第一个 file 字段），返回 { buffer, filename }
async function readUpload(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('file too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks);
        const ctype = req.headers['content-type'] || '';
        const m = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!m) return reject(new Error('not multipart'));
        const boundary = m[1] || m[2];
        const parts = raw.toString('latin1').split('--' + boundary);
        for (const part of parts) {
          if (part.includes('filename=')) {
            const fnMatch = part.match(/filename="([^"]*)"/);
            const start = part.indexOf('\r\n\r\n');
            if (start === -1) continue;
            let body = part.slice(start + 4);
            // 去掉结尾的 \r\n
            if (body.endsWith('\r\n')) body = body.slice(0, -2);
            const buffer = Buffer.from(body, 'latin1');
            return resolve({ buffer, filename: fnMatch ? fnMatch[1] : 'upload.bin' });
          }
        }
        reject(new Error('no file field'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  const clean = req.url.split('?')[0];
  let p = clean === '/' ? '/index.html' : clean;
  // 优先在 dist（React 构建产物）查找，找不到再回退 public（旧原型）
  for (const base of [DIST, PUBLIC]) {
    const filePath = normalize(join(base, p));
    if (!filePath.startsWith(base)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) throw new Error('dir');
      const buf = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(buf);
      return;
    } catch {
      // 尝试该 base 下的 index.html（SPA 路由回退）
      try {
        const idx = await readFile(join(base, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(idx);
        return;
      } catch {}
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>404</h1>');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const q = url.searchParams.get('q') || url.searchParams.get('query') || '';

  try {
    if (req.method === 'GET' && url.pathname === '/api/hot') {
      const items = await zhihu.zhihuHot(SECRET, 30, TTL);
      return sendJson(res, { ok: true, data: { mock: !SECRET, items } });
    }
    if (req.method === 'GET' && url.pathname === '/api/search') {
      if (!q) return sendJson(res, { ok: false, code: 'MISSING_Q', message: '缺少搜索关键词 q' }, 400);
      const items = await zhihu.zhihuSearch(SECRET, q, 10, TTL);
      return sendJson(res, { ok: true, data: { mock: !SECRET, items } });
    }
    if (req.method === 'POST' && url.pathname === '/api/alchemy') {
      let body = {};
      try { body = await readBody(req); } catch {}
      const topic = body.topic || q;
      if (!topic) return sendJson(res, { ok: false, code: 'MISSING_TOPIC', message: '缺少 topic' }, 400);
      let persona = body.persona || { identity: 'pre', industry: 'ai', sub: 'AIGC' };
      const result = await zhihu.alchemy(SECRET, topic, persona);
      return sendJson(res, { ok: true, data: result });
    }
    if (req.method === 'GET' && url.pathname === '/api/alchemy') {
      if (!q) return sendJson(res, { ok: false, code: 'MISSING_Q', message: '缺少搜索关键词 q' }, 400);
      let persona = { identity: 'pre', industry: 'ai', sub: 'AIGC' };
      try { const p = url.searchParams.get('persona'); if (p) persona = JSON.parse(p); } catch {}
      const result = await zhihu.alchemy(SECRET, q, persona);
      return sendJson(res, { ok: true, data: result });
    }

    // 模块③-b：文档转文本（调本地 MarkItDown 服务，覆盖 PDF/Word/图片等）
    if (req.method === 'POST' && url.pathname === '/api/parse-doc') {
      try {
        const { buffer, filename } = await readUpload(req);
        if (!buffer || !buffer.length) return sendJson(res, { ok: false, code: 'EMPTY_FILE', message: '文件为空' }, 400);
        const text = await parseDocViaMd(buffer, filename);
        return sendJson(res, { ok: true, data: { text } });
      } catch (e) {
        // MarkItDown 服务未启动或解析失败：给出清晰提示，不阻断（前端可回退手动填写）
        return sendJson(res, { ok: false, code: 'DOC_PARSE_FAILED', message: '文档解析失败：' + (e.message || '请确认 MarkItDown 服务已启动（python md_server.py）') });
      }
    }

    // 模块③：简历解析（前端已把 PDF/DOCX/TXT/图片 提取为文本，这里调直答抽取结构化字段）
    if (req.method === 'POST' && url.pathname === '/api/resume') {
      let body = {};
      try { body = await readBody(req); } catch {}
      if (!body.text || !String(body.text).trim()) return sendJson(res, { ok: false, code: 'EMPTY_TEXT', message: '简历文本为空' }, 400);
      console.log('[server /api/resume] text length:', String(body.text).length, 'secret exists:', !!SECRET);
      if (!SECRET || !SECRET.trim()) {
        return sendJson(res, { ok: false, code: 'NO_SECRET', message: '服务器未配置 ZHIHU_ACCESS_SECRET，无法调用知乎直答解析简历。可手动填写背景摘要继续使用，或联系管理员配置 API Secret。', data: { reason: 'no-secret', fields: {} } });
      }
      const r = await zhihu.extractResume(SECRET, String(body.text));
      console.log('[server /api/resume] zhihu response ok:', r.ok, 'reason:', r.reason);
      if (r.ok) {
        return sendJson(res, { ok: true, data: r });
      } else {
        return sendJson(res, { ok: false, code: r.reason || 'EXTRACT_FAILED', message: r.message || '解析失败', data: r });
      }
    }

    // ---- 健康检测：验证 ZHIHU_ACCESS_SECRET 是否能调通知乎 ----
    if (req.method === 'GET' && url.pathname === '/api/health') {
      if (!SECRET || !SECRET.trim()) {
        return sendJson(res, { ok: false, code: 'NO_SECRET', message: '未配置 ZHIHU_ACCESS_SECRET，请在 .env 中填入。', data: { configured: false } });
      }
      try {
        // 做一次轻量调用验证（用极简问题探测接口是否可用）
        const probe = await zhihu.alchemy(SECRET, '测试', { identity: 'pre', industry: 'ai', sub: 'AIGC' });
        // 只要网络能返回（无论有没有真实内容），都算 secret 有效
        return sendJson(res, {
          ok: true,
          data: {
            configured: true,
            reachable: !probe.error,
            message: probe.error ? `Secret 已配置，但调用返回错误：${probe.error}` : 'Secret 有效，知乎接口可正常调用。',
            raw: typeof probe === 'object' ? Object.keys(probe) : null,
          }
        });
      } catch (e) {
        return sendJson(res, { ok: false, code: 'PROBE_FAILED', message: 'Secret 已配置，但调用知乎失败：' + (e.message || '未知错误'), data: { configured: true, reachable: false } });
      }
    }

    // ---- 板块2：OAuth 接入（知乎账号授权 → 基于关注/粉丝做信息宇宙分析） ----
    if (req.method === 'GET' && url.pathname === '/api/oauth/config') {
      return sendJson(res, {
        ok: true,
        data: {
          mock: oauth.oauthConfig.MOCK,
          hasAppCreds: oauth.oauthConfig.hasAppCreds,
          redirectUri: oauth.oauthConfig.REDIRECT_URI,
        }
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/oauth/login') {
      // 真实模式跳转知乎授权页；mock 模式直接走本地回调
      if (oauth.oauthConfig.MOCK) {
        return res.writeHead(302, { Location: '/api/oauth/callback?code=mock_code&state=alchemy' }).end();
      }
      return res.writeHead(302, { Location: oauth.getAuthorizeUrl('alchemy') }).end();
    }
    if (req.method === 'GET' && url.pathname === '/api/oauth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code) return sendJson(res, { ok: false, code: 'MISSING_CODE', message: '缺少 code 参数' }, 400);
      try {
        const tokenRes = await oauth.exchangeToken(code);
        const user = await oauth.getUserInfo(tokenRes.access_token);
        const payload = JSON.stringify({ ok: true, token: tokenRes, user, mock: oauth.oauthConfig.MOCK });
        // 返回一个弹窗回调页，通过 postMessage 把结果传回主窗口
        const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>授权回调</title><style>
body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f7f9fb;color:#1a1a1a;text-align:center;padding:20px}
.card{max-width:360px;background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,.08)}
h2{margin:0 0 10px;font-size:18px;color:#0066ff}
p{margin:0;color:#666;line-height:1.6}
</style></head>
<body>
<div class="card"><h2>知乎授权成功</h2><p>正在把数据传回知乎炼金术…</p></div>
<script>
try{window.opener.postMessage({type:'zhihu-oauth',payload:${payload}},'*');}catch(e){console.error(e)}
setTimeout(()=>window.close(),800);
</script>
</body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      } catch (e) {
        return sendJson(res, { ok: false, code: 'OAUTH_FAILED', message: String(e?.message || e) }, 500);
      }
    }

    return serveStatic(req, res);
  } catch (e) {
    return sendJson(res, { ok: false, code: 'SERVER_ERROR', message: String(e?.message || e) }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`知乎炼金术 running → http://localhost:${PORT}`);
  console.log(SECRET ? '模式：LIVE（已接入知乎真实 API）' : '模式：DEMO（未配置 Access Secret，使用演示数据）');
});
