// 山外山 · 轻量后端（Node 内置模块，零三方依赖）
// 职责：托管前端静态文件 + 代理知乎 API（Secret 仅存后端，绝不进前端）
import { createServer } from 'node:http';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, normalize, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import crypto from 'node:crypto';
import * as zhihu from './zhihu.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// React 构建产物托管目录：默认本仓库 dist/（云端 Linux 与队友开箱即用，构建产物就在这里）；
// 本机如需自定义交付目录可用 KAN_DIST 覆盖（如 KAN_DIST=E:/kan-dist，Windows）。
// 路径统一经 resolve/join 归一化（Windows 下 join/normalize 会产出反斜杠），
// 保证下方 startsWith 判目录穿越时两段分隔符一致，否则会误判 403（页面打不开）。
const DIST = process.env.KAN_DIST ? resolve(process.env.KAN_DIST) : join(__dirname, 'dist');

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
const oauth = await import('./oauth.js');
const oauthSessions = new Map();
const oauthStates = new Map();
const SYNC_FILE = join(__dirname, '.cache', 'oauth-archives.json');
const SYNC_KEY = process.env.SYNC_STORAGE_KEY || '';

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((out, part) => {
    const i = part.indexOf('='); if (i < 0) return out;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); return out;
  }, {});
}
function sessionCookieName() { return process.env.NODE_ENV === 'production' ? '__Host-shanwaishan-session' : 'shanwaishan-session'; }
function sessionUser(req) {
  const token = parseCookies(req)[sessionCookieName()];
  return token ? oauthSessions.get(token) || null : null;
}
function setSessionCookie(res, token, maxAge = 60 * 60 * 24 * 30) {
  res.setHeader('Set-Cookie', `${sessionCookieName()}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
function oauthReady() { return Boolean(oauth.oauthConfig.hasAppCreds && SYNC_KEY); }
function stableUserId(info) {
  const raw = String(info?.id || info?.uid || info?.url_token || info?.name || JSON.stringify(info));
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}
function archiveCipher(text, mode) {
  if (!SYNC_KEY) return text;
  const key = crypto.createHash('sha256').update(SYNC_KEY).digest();
  if (mode === 'encrypt') {
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return `${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
  }
  const [iv, tag, body] = String(text).split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}
function loadArchives() { try { return JSON.parse(readFileSync(SYNC_FILE, 'utf8')); } catch { return {}; } }
async function saveArchive(userId, archive) {
  const all = loadArchives(); all[userId] = archive;
  await mkdir(dirname(SYNC_FILE), { recursive: true });
  await writeFile(SYNC_FILE, JSON.stringify(all), 'utf8');
}

// 鉴权密钥：主名 OPENAI_API_KEY（对齐 OpenAI 生态，见 DECISIONS D-11）；旧名 ZHIHU_ACCESS_SECRET 保留为回退
const SECRET = process.env.OPENAI_API_KEY || process.env.ZHIHU_ACCESS_SECRET || '';
const DEMO_MODE = /^(1|true|yes)$/i.test(process.env.DEMO_MODE || '');
const ACTIVE_SECRET = DEMO_MODE ? '' : SECRET;
const ACTIVE_STEPFUN = DEMO_MODE ? '' : (process.env.STEPFUN_API_KEY || '');
const PORT = process.env.PORT || 3000;
const TTL = Number(process.env.CACHE_TTL || 3600);
// 直答模型（与 zhihu.js 内部默认值保持一致，可经 OPENAI_MODEL 环境变量覆盖）
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'zhida-fast-1p5';

function envInt(name, fallback, min = 1) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

// 公开比赛服务必须同时防刷和保护官方日额度。窗口限流按客户端，日预算按整个部署实例；
// 日预算只记录日期与次数，不保存 IP、请求或用户内容，并写入 .cache 以跨重启生效。
const RATE_WINDOW_MS = envInt('API_RATE_WINDOW_MS', 60_000, 1000);
const RATE_LIMITS = {
  hot: envInt('API_RATE_LIMIT_HOT', 30),
  search: envInt('API_RATE_LIMIT_SEARCH', 30),
  alchemy: envInt('API_RATE_LIMIT_ALCHEMY', 6),
  actions: envInt('API_RATE_LIMIT_ACTIONS', 10),
  resume: envInt('API_RATE_LIMIT_RESUME', 6),
  chat: envInt('API_RATE_LIMIT_CHAT', 20),
};
const DAILY_LIMITS = {
  hot: envInt('API_DAILY_HOT_LIMIT', 80),
  search: envInt('API_DAILY_SEARCH_LIMIT', 4000),
  ai: envInt('API_DAILY_AI_LIMIT', 80),
};
const RATE_ROUTES = new Map([
  ['GET /api/hot', 'hot'],
  ['GET /api/search', 'search'],
  ['POST /api/alchemy', 'alchemy'],
  ['POST /api/actions', 'actions'],
  ['POST /api/resume', 'resume'],
  ['POST /api/chat', 'chat'],
]);
const API_METHODS = new Map([
  ['/api/hot', 'GET'], ['/api/search', 'GET'], ['/api/alchemy', 'POST'], ['/api/actions', 'POST'],
  ['/api/resume', 'POST'], ['/api/chat', 'POST'], ['/api/health', 'GET'],
]);
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '') || Boolean(process.env.RAILWAY_ENVIRONMENT);
const rateWindows = new Map();
let rateSweep = 0;
const BUDGET_FILE = join(__dirname, '.cache', 'api-daily-budget.json');

function chinaDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function loadDailyBudget() {
  try {
    const parsed = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
    if (parsed && parsed.date === chinaDate()) {
      return { date: parsed.date, hot: Number(parsed.hot) || 0, search: Number(parsed.search) || 0, ai: Number(parsed.ai) || 0 };
    }
  } catch {}
  return { date: chinaDate(), hot: 0, search: 0, ai: 0 };
}
let dailyBudget = loadDailyBudget();
let budgetWrite = Promise.resolve();

function persistDailyBudget() {
  budgetWrite = budgetWrite.then(async () => {
    await mkdir(dirname(BUDGET_FILE), { recursive: true });
    await writeFile(BUDGET_FILE, JSON.stringify(dailyBudget), 'utf8');
  }).catch(() => {});
  return budgetWrite;
}

async function reserveDailyMany(charges) {
  const needsProvider = charges.some(([bucket]) => bucket === 'ai' ? (ACTIVE_SECRET || ACTIVE_STEPFUN) : ACTIVE_SECRET);
  if (!needsProvider) return true;
  const today = chinaDate();
  if (dailyBudget.date !== today) dailyBudget = { date: today, hot: 0, search: 0, ai: 0 };
  if (charges.some(([bucket, amount]) => (dailyBudget[bucket] || 0) + amount > DAILY_LIMITS[bucket])) return false;
  charges.forEach(([bucket, amount]) => { dailyBudget[bucket] = (dailyBudget[bucket] || 0) + amount; });
  await persistDailyBudget();
  return true;
}

function reserveDaily(bucket, amount = 1) { return reserveDailyMany([[bucket, amount]]); }

function dailyRetryAfter() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).reduce((o, p) => ({ ...o, [p.type]: Number(p.value) || 0 }), {});
  const elapsed = parts.hour * 3600 + parts.minute * 60 + parts.second;
  return Math.max(1, 86400 - elapsed);
}

function clientId(req) {
  const forwarded = TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return (forwarded || req.socket.remoteAddress || 'unknown').slice(0, 80);
}

function allowClient(req, route) {
  const now = Date.now();
  const key = `${clientId(req)}:${route}`;
  let slot = rateWindows.get(key);
  if (!slot || now - slot.start >= RATE_WINDOW_MS) slot = { start: now, count: 0 };
  slot.count += 1;
  rateWindows.set(key, slot);
  if (++rateSweep % 200 === 0) {
    for (const [k, v] of rateWindows) if (now - v.start >= RATE_WINDOW_MS) rateWindows.delete(k);
  }
  return { allowed: slot.count <= RATE_LIMITS[route], retryAfter: Math.max(1, Math.ceil((slot.start + RATE_WINDOW_MS - now) / 1000)) };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

async function sendJson(res, data, status = 200, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

function bodyError(res, err) {
  const tooLarge = /too large/i.test(String(err?.message || ''));
  return sendJson(res, {
    ok: false,
    code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
    message: tooLarge ? '提交内容过大，请精简后重试。' : '请求格式不正确，请刷新后重试。',
  }, tooLarge ? 413 : 400);
}

// 读取请求体 JSON（带长度上限，防止超大请求）
async function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { tooLarge = true; return; }
      if (tooLarge) return;
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new Error('body too large'));
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

// 把前端传来的历史炼金包清单拼成知识库文本（轻量 RAG：不依赖向量库）
function buildKnowledgeBase(kb) {
  if (!Array.isArray(kb) || !kb.length) return '（你还没炼过，我先听着）';
  return kb.map((k, i) => `【历史 ${i + 1}】${k.topic || '未命名'}\n${k.text || ''}`).join('\n\n');
}

// 模型可能仍返回姓名/联系方式；服务端在响应前再做一次白名单过滤，避免直接标识符进入前端与本地历史。
function sanitizeResumeFields(fields) {
  const f = fields && typeof fields === 'object' ? fields : {};
  return {
    city: String(f.city || ''),
    education: String(f.education || ''),
    experience: String(f.experience || ''),
    projects: Array.isArray(f.projects) ? f.projects.slice(0, 20).map((p) => ({
      name: String(p?.name || ''),
      role: String(p?.role || ''),
      highlights: Array.isArray(p?.highlights) ? p.highlights.slice(0, 20).map(String) : [],
    })) : [],
    skills: Array.isArray(f.skills) ? f.skills.slice(0, 50).map(String) : [],
    skillLevels: f.skillLevels && typeof f.skillLevels === 'object' ? f.skillLevels : {},
    industry: String(f.industry || ''),
    roles: Array.isArray(f.roles) ? f.roles.slice(0, 20).map(String) : [],
    salary: String(f.salary || ''),
    certs: Array.isArray(f.certs) ? f.certs.slice(0, 30).map(String) : [],
    languages: Array.isArray(f.languages) ? f.languages.slice(0, 20).map(String) : [],
    summary: String(f.summary || ''),
  };
}

async function serveStatic(req, res) {
  const clean = req.url.split('?')[0];
  let p = clean === '/' ? '/index.html' : clean;
  try { p = decodeURIComponent(p); } catch {} // 中文/空格文件名（如 /liukanshan/待机_5秒…gif）需解码才能定位到真实文件
  // 仅托管 dist/（React 构建产物）。未构建时明确报错，避免静默回退到旧版页面
  const filePath = normalize(join(DIST, p));
  const rel = relative(DIST, filePath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    res.writeHead(403, SECURITY_HEADERS).end('Forbidden');
    return;
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) throw new Error('dir');
    const buf = await readFile(filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
    return;
  } catch {
    // 文件不存在 → SPA 路由回退到 dist/index.html；连构建产物都没有 → 404（先执行 npm run build）
    try {
      const idx = await readFile(join(DIST, 'index.html'));
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(idx);
      return;
    } catch {}
  }
  res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>404</h1><p>页面还在准备中：请先把前端打包好，再启动服务。</p>');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const q = url.searchParams.get('q') || url.searchParams.get('query') || '';

  try {
    if (url.pathname === '/api/auth/config' && req.method === 'GET') {
      return sendJson(res, { ok: true, data: { enabled: oauthReady(), mock: oauth.oauthConfig.MOCK, message: oauthReady() ? '可使用知乎账号保存行动簿。' : '当前为游客模式；配置 OAuth 与同步密钥后可登录。' } });
    }
    if (url.pathname === '/api/auth/login' && req.method === 'GET') {
      if (!oauthReady()) return sendJson(res, { ok: false, code: 'AUTH_NOT_CONFIGURED', message: '当前未配置知乎登录，游客模式仍可正常使用。' }, 503);
      const state = crypto.randomBytes(18).toString('base64url'); oauthStates.set(state, Date.now() + 10 * 60 * 1000);
      return sendJson(res, { ok: true, data: { authorizeUrl: oauth.getAuthorizeUrl(state) } });
    }
    if (url.pathname === '/api/auth/callback' && req.method === 'GET') {
      const state = url.searchParams.get('state') || ''; const code = url.searchParams.get('authorization_code') || url.searchParams.get('code');
      const expiry = oauthStates.get(state); oauthStates.delete(state);
      if (!expiry || expiry < Date.now() || !code) return sendJson(res, { ok: false, code: 'AUTH_CALLBACK_INVALID', message: '登录授权已失效，请返回后重试。' }, 400);
      try {
        const token = await oauth.exchangeToken(code); const info = await oauth.getUserInfo(token.access_token); const userId = stableUserId(info);
        const session = crypto.randomBytes(32).toString('base64url'); oauthSessions.set(session, { userId, name: info?.name || '知乎用户', token: token.access_token, mock: !!token.mock, createdAt: Date.now() });
        setSessionCookie(res, session);
        res.writeHead(302, { ...SECURITY_HEADERS, Location: '/?auth=success' }); res.end(); return;
      } catch (e) { return sendJson(res, { ok: false, code: 'AUTH_EXCHANGE_FAILED', message: '知乎授权没有完成，仍可继续以游客模式使用。' }, 502); }
    }
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const user = sessionUser(req); return sendJson(res, { ok: true, data: user ? { authenticated: true, user: { id: user.userId, name: user.name, mock: user.mock } } : { authenticated: false } });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = parseCookies(req)[sessionCookieName()]; if (token) oauthSessions.delete(token); setSessionCookie(res, '', 0);
      return sendJson(res, { ok: true, data: { authenticated: false } });
    }
    if (url.pathname === '/api/sync/archive' && (req.method === 'GET' || req.method === 'PUT')) {
      const user = sessionUser(req); if (!user) return sendJson(res, { ok: false, code: 'AUTH_REQUIRED', message: '请先登录知乎账号，或继续使用本地档案。' }, 401);
      if (req.method === 'GET') {
        const raw = loadArchives()[user.userId]; if (!raw) return sendJson(res, { ok: true, data: { archive: null } });
        try { return sendJson(res, { ok: true, data: { archive: JSON.parse(archiveCipher(raw, 'decrypt')) } }); } catch { return sendJson(res, { ok: false, code: 'SYNC_DATA_INVALID', message: '云端档案暂时无法读取。' }, 500); }
      }
      let body = {}; try { body = await readBody(req, 2_000_000); } catch (e) { return bodyError(res, e); }
      if (!body.archive || body.archive.type !== 'zhihu-alchemy-archive') return sendJson(res, { ok: false, code: 'INVALID_ARCHIVE', message: '档案格式不正确。' }, 400);
      await saveArchive(user.userId, archiveCipher(JSON.stringify(body.archive), 'encrypt'));
      return sendJson(res, { ok: true, data: { savedAt: Date.now() } });
    }
    if (url.pathname.startsWith('/api/oauth/')) {
      return sendJson(res, { ok: false, code: 'OAUTH_ROUTE_MOVED', message: '请使用 /api/auth/* 登录接口；旧版 /api/oauth/* 路由不再使用。' }, 410);
    }
    if (url.pathname === '/api/parse-doc') {
      return sendJson(res, {
        ok: false,
        code: 'FILE_UPLOAD_DISABLED',
        message: '为保护简历隐私，比赛版本不接收原文件；请在浏览器解析或粘贴文字。',
      }, 410);
    }
    const allowedMethod = API_METHODS.get(url.pathname);
    if (allowedMethod && req.method !== allowedMethod) {
      return sendJson(res, { ok: false, code: 'METHOD_NOT_ALLOWED', message: `该接口仅支持 ${allowedMethod}。` }, 405, { Allow: allowedMethod });
    }
    const route = RATE_ROUTES.get(`${req.method} ${url.pathname}`);
    if (route) {
      const rate = allowClient(req, route);
      if (!rate.allowed) {
        return sendJson(res, {
          ok: false,
          code: 'RATE_LIMITED',
          message: '请求有点密，请稍等一会儿再试。',
        }, 429, { 'Retry-After': String(rate.retryAfter) });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/hot') {
      const live = await reserveDaily('hot');
      const requestSecret = live ? ACTIVE_SECRET : '';
      const items = await zhihu.zhihuHot(requestSecret, 30, TTL);
      return sendJson(res, { ok: true, data: { mock: !requestSecret, quotaFallback: !live, quotaCode: live ? undefined : 'DAILY_LIMIT_REACHED', items } });
    }
    if (req.method === 'GET' && url.pathname === '/api/search') {
      if (!q) return sendJson(res, { ok: false, code: 'MISSING_Q', message: '缺个关键词' }, 400);
      const live = await reserveDaily('search');
      const requestSecret = live ? ACTIVE_SECRET : '';
      const items = await zhihu.zhihuSearch(requestSecret, q, 10, TTL);
      return sendJson(res, { ok: true, data: { mock: !requestSecret, quotaFallback: !live, quotaCode: live ? undefined : 'DAILY_LIMIT_REACHED', items } });
    }
    if (req.method === 'POST' && url.pathname === '/api/alchemy') {
      let body = {};
      try { body = await readBody(req); } catch (e) { return bodyError(res, e); }
      const topic = body.topic || q;
      if (!topic) return sendJson(res, { ok: false, code: 'MISSING_TOPIC', message: '缺少 topic' }, 400);
      let persona = body.persona || { identity: 'pre', industry: 'ai', sub: 'AIGC' };
      // 前端按处境卡构造了多角度检索词（buildQueries），此前未透传导致实际只用了 1 个角度
      const queries = Array.isArray(body.queries) ? body.queries.slice(0, 5) : [];
      // 决策B：把历史炼金包透传给炼金，仅带相关条目（后端实体命中判定 + 防串味）
      const records = Array.isArray(body.records) ? body.records.slice(0, 30) : [];
      const queryCount = queries.length || 1;
      const live = await reserveDailyMany([['ai', 2], ['search', queryCount * 2]]); // 原子预留，避免只扣一半预算
      const requestSecret = live ? ACTIVE_SECRET : '';
      const result = await zhihu.alchemy(requestSecret, topic, persona, queries, records);
      if (!live && ACTIVE_SECRET) { result.quotaFallback = true; result.quotaCode = 'DAILY_LIMIT_REACHED'; }
      return sendJson(res, { ok: true, data: result });
    }

    // ---- 按自测反馈重生行动地图：把"最信哪一派 / 哪些盲区"喂给模型，生成贴合辨向的验证路线 ----
    if (req.method === 'POST' && url.pathname === '/api/actions') {
      let body = {};
      try { body = await readBody(req); } catch (e) { return bodyError(res, e); }
      const topic = body.topic || '';
      const roles = Array.isArray(body.roles) ? body.roles : [];
      const quizResult = body.quizResult || null;
      const persona = body.persona || {};
      // 本次检索到的真实资料：作为路线生成的"事实锚"，任务的事实断言只能引用它们或标 verify
      const sources = Array.isArray(body.sources) ? body.sources : [];
      // 上一轮（及历史各轮）行动的现实结果：已证实的不再重复验证，被打脸的降优先级/建议换路
      const feedback = Array.isArray(body.feedback) ? body.feedback.slice(0, 5) : [];
      const currentTask = body.currentTask && body.currentTask.started ? body.currentTask : null;
      if (!topic || !roles.length) return sendJson(res, { ok: false, code: 'MISSING', message: '缺少 topic 或 roles' }, 400);
      const live = await reserveDaily('ai', 2); // 完整路线底层最多两次直答尝试
      const requestSecret = live ? ACTIVE_SECRET : '';
      const r = await zhihu.generateActions(requestSecret, topic, roles, quizResult, persona, sources, feedback, currentTask);
      if (!live && ACTIVE_SECRET) { r.quotaFallback = true; r.quotaCode = 'DAILY_LIMIT_REACHED'; }
      return sendJson(res, { ok: true, data: r });
    }

    // 模块③：简历解析（前端已把 PDF/DOCX/TXT/图片 提取为文本，这里调直答抽取结构化字段）
    if (req.method === 'POST' && url.pathname === '/api/resume') {
      let body = {};
      try { body = await readBody(req); } catch (e) { return bodyError(res, e); }
      if (!body.text || !String(body.text).trim()) return sendJson(res, { ok: false, code: 'EMPTY_TEXT', message: '简历文本为空' }, 400);
      const live = await reserveDaily('ai');
      const requestSecret = live ? ACTIVE_SECRET : '';
      if (!live && (ACTIVE_SECRET || ACTIVE_STEPFUN)) {
        return sendJson(res, {
          ok: false, code: 'DAILY_LIMIT_REACHED', message: '今天的 AI 整理额度已用完，你仍可手动填写背景。',
        }, 429, { 'Retry-After': String(dailyRetryAfter()) });
      }
      const r = await zhihu.extractResume(requestSecret, String(body.text), { allowStepfun: live });
      if (r.ok) {
        return sendJson(res, { ok: true, data: { ...r, fields: sanitizeResumeFields(r.fields) } });
      } else {
        return sendJson(res, { ok: true, data: r });
      }
    }

    // ---- 知识库 / RAG 对话：把历史炼金包作为知识库上下文，AI 引用回答 ----
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      let body = {};
      try { body = await readBody(req, 1_000_000); } catch (e) { return bodyError(res, e); }
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const kb = Array.isArray(body.kb) ? body.kb : [];
      if (!messages.length) return sendJson(res, { ok: false, code: 'EMPTY', message: '消息为空' }, 400);
      const knowledge = buildKnowledgeBase(kb);
      const lastUser = messages[messages.length - 1]?.content || '';
      const sys = `你是「刘看山」，山外山里的 AI 伙伴，像一位长期陪用户翻山、练判断力的朋友。\n用户过去炼过的炼金包如下：\n${knowledge}\n\n回答原则：\n1) 如果用户问到他某次炼金包的内容，请直接引用对应分析作答；\n2) 如果他没炼过相关的，可基于知乎通用「信谁框架」给建议，并明确说明这是通用建议、不是来自他的历史；\n3) 多结合用户的处境（阶段/目标/城市/时间压力）说话，别泛泛而谈。\n4) 用中文，简洁有温度，语气像一个陪你爬山的伙伴。`;
      const prompt = sys + '\n\n用户最新问题：' + lastUser;
      let reply = '';
      const live = await reserveDaily('ai');
      const requestSecret = live ? ACTIVE_SECRET : '';
      if (requestSecret) reply = await zhihu.zhihuZhida(requestSecret, prompt, OPENAI_MODEL, 600, '');
      if (!reply) reply = '（这会儿还没接上能回答的服务。你可以先去「我的山径」翻翻以前炼过的。）';
      return sendJson(res, { ok: true, data: { reply, quotaFallback: !requestSecret && Boolean(ACTIVE_SECRET) } });
    }

    // ---- 健康检测：验证 OPENAI_API_KEY（旧名 ZHIHU_ACCESS_SECRET 回退）是否可用（走免费额度接口，不烧直答 100 次/天配额） ----
    if (req.method === 'GET' && url.pathname === '/api/health') {
      if (!ACTIVE_SECRET || !ACTIVE_SECRET.trim()) {
        return sendJson(res, { ok: false, code: 'NO_SECRET', message: '还没接上知乎（找不到可用的密钥）。配上之后，就能取真实数据了。', data: { configured: false } });
      }
      const q = await zhihu.zhihuQuota(ACTIVE_SECRET);
      if (q.ok) {
        return sendJson(res, {
          ok: true,
          data: {
            configured: true,
            reachable: true,
            message: '已接上知乎，能正常取数。',
            raw: q.data, // 额度详情，前端展示用
          }
        });
      }
      return sendJson(res, { ok: false, code: 'PROBE_FAILED', message: `知乎这边接上了，但没探到额度：${q.reason || '未知错误'}`, data: { configured: true, reachable: false } });
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, { ok: false, code: 'NOT_FOUND', message: '接口不存在。' }, 404);
    }
    return serveStatic(req, res);
  } catch (e) {
    console.error('[server] request failed:', e?.name || 'Error');
    return sendJson(res, { ok: false, code: 'SERVER_ERROR', message: '服务暂时出了点问题，请稍后重试。' }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`山外山 running → http://localhost:${PORT}`);
  console.log(ACTIVE_SECRET ? '模式：LIVE（已接入知乎真实数据）' : '模式：DEMO（使用示例数据，不消耗接口额度）');
});
