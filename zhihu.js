// 知乎开放平台 API 客户端（含本地缓存 + Mock 兜底）
// 文档来源：zhihu-hackathon-skill 中的 http-api.md / user-api.md / open-platform.md
// 知乎直答本身是 OpenAI 兼容接口（POST {OPENAI_BASE_URL}/chat/completions + messages + choices[0].message.content）；
// 端点/模型可用环境变量 OPENAI_BASE_URL / OPENAI_MODEL 覆盖，默认值即知乎直答现状（命名对齐见 DECISIONS D-11）
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '.cache');

// 读取 .env（幂等，server.mjs 若已加载则本处不覆盖已存在的变量；此处保证独立调用时也能读到密钥）
try {
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(join(__dirname, '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const API_BASE = 'https://developer.zhihu.com';

function authHeaders(secret) {
  return {
    Authorization: `Bearer ${secret}`,
    'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
    'Content-Type': 'application/json',
  };
}

// ---------- 极简文件缓存（应对知乎 API 频次限制） ----------
async function cacheGet(key) {
  try {
    const p = join(CACHE_DIR, `${hash(key)}.json`);
    if (!existsSync(p)) return null;
    const raw = await readFile(p, 'utf8');
    const { expire, data } = JSON.parse(raw);
    if (Date.now() > expire) return null;
    return data;
  } catch {
    return null;
  }
}
async function cacheSet(key, data, ttlSec = 3600) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const p = join(CACHE_DIR, `${hash(key)}.json`);
    await writeFile(p, JSON.stringify({ expire: Date.now() + ttlSec * 1000, data }), 'utf8');
  } catch {
    /* 缓存失败不影响主流程 */
  }
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return 'c' + (h >>> 0).toString(36);
}

const hasSecret = (secret) => Boolean(secret && secret.trim());

// ---------- StepFun（阶跃星辰）大模型：用于简历解析兜底，独立于知乎 Secret ----------
const STEPFUN_KEY = process.env.STEPFUN_API_KEY || '';
const STEPFUN_URL = process.env.STEPFUN_API_URL || 'https://api.stepfun.com/step_plan/v1/chat/completions';
const STEPFUN_MODEL = process.env.STEPFUN_MODEL || 'step-3.7-flash';

// ---------- 直答端点/模型：OpenAI 兼容命名（DECISIONS D-11），默认值 = 知乎直答现状 ----------
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://developer.zhihu.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'zhida-fast-1p5';

async function stepfunChat(prompt, model = STEPFUN_MODEL, ttl = 86400) {
  if (!STEPFUN_KEY || !STEPFUN_KEY.trim()) return '';
  const ck = `stepfun:${model}:${hash(prompt)}`;
  const hit = await cacheGet(ck);
  if (hit) return hit;
  try {
    const r = await fetch(STEPFUN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STEPFUN_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const rawText = await r.text();
    if (!r.ok) {
      console.error('[stepfun] HTTP error', r.status, rawText.slice(0, 200));
      return '';
    }
    const j = JSON.parse(rawText);
    const text = j?.choices?.[0]?.message?.content ?? '';
    if (text) await cacheSet(ck, text, ttl);
    return text;
  } catch (err) {
    console.error('[stepfun] error', err?.name || err?.message || err);
    return '';
  }
}

// ---------- 1. 知乎搜索 ----------
export async function zhihuSearch(secret, query, count = 10, ttl = 3600) {
  if (!hasSecret(secret)) return MOCK.search(query);
  const ck = `search:${query}:${count}`;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  const url = new URL(`${API_BASE}/api/v1/content/zhihu_search`);
  url.searchParams.set('Query', query);
  url.searchParams.set('Count', String(count));
  const r = await fetch(url, { headers: authHeaders(secret), signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  const items = (j?.Data?.Items ?? []).map((it) => ({
    title: it.Title,
    summary: it.ContentText,
    url: it.Url,
    voteUp: it.VoteUpCount,
    comment: it.CommentCount,
    authority: it.AuthorityLevel,
    author: it.AuthorName,
    type: it.ContentType,
  }));
  await cacheSet(ck, items, ttl);
  return items;
}

// ---------- 1.5 全网搜索（补充知乎站内单一来源短板；零额外依赖，额度 5000/天） ----------
// 返回字段与 zhihuSearch 对齐（title/summary/url/voteUp/...），额外带 source:'web' 便于前端区分；
// 无 Secret 时返回空数组（不影响 demo，MOCK 走 topicMock 不触接口）。
export async function zhihuGlobalSearch(secret, query, count = 10, ttl = 3600) {
  if (!hasSecret(secret)) return [];
  const ck = `global:${query}:${count}`;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  const url = new URL(`${API_BASE}/api/v1/content/global_search`);
  url.searchParams.set('Query', query);
  url.searchParams.set('Count', String(count));
  try {
    const r = await fetch(url, { headers: authHeaders(secret), signal: AbortSignal.timeout(12000) });
    // 中文站点常返回 GBK/GB2312，直接 .json() 会读成乱码；先按响应头 charset 解码
    const ct = r.headers.get('content-type') || '';
    const charsetMatch = ct.match(/charset\s*=\s*([\w-]+)/i);
    const charset = (charsetMatch?.[1] || 'utf-8').toLowerCase();
    const buf = await r.arrayBuffer();
    const enc = /gb|big5/.test(charset) ? charset : 'utf-8';
    const text = new TextDecoder(enc).decode(buf);
    const j = JSON.parse(text);
    const kws = topicKeywords(query);
    const items = (j?.Data?.Items ?? []).map((it) => {
      const rawUrl = it.Url || it.Link || '';
      return {
        title: decodeHtmlEntities(it.Title),
        summary: decodeHtmlEntities(it.ContentText || it.Summary || it.Abstract || ''),
        url: rawUrl || `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`,
        voteUp: it.VoteUpCount ?? 0,
        comment: it.CommentCount ?? 0,
        authority: it.AuthorityLevel ?? '',
        author: cleanAuthor(it.AuthorName || it.Author, true, rawUrl),
        type: it.ContentType || 'Web',
        source: 'web',
      };
    }).filter((it) => {
      // 全网结果容易混入 SEO 垃圾或乱码，只保留标题/摘要干净且含检索词的
      if (looksMojiboke(it.title) || looksMojiboke(it.summary)) return false;
      const t = String(it.title || '') + ' ' + String(it.summary || '');
      return kws.some((k) => t.includes(k));
    });
    await cacheSet(ck, items, ttl);
    return items;
  } catch (err) {
    console.error('[globalSearch] error', err?.name || err?.message || err);
    return [];
  }
}

// ---------- 2. 知乎热榜 ----------
export async function zhihuHot(secret, limit = 30, ttl = 3600) {
  if (!hasSecret(secret)) return MOCK.hot();
  const ck = `hot:${limit}`;
  const cached = await cacheGet(ck);
  if (cached) return cached;
  const url = `${API_BASE}/api/v1/content/hot_list?Limit=${limit}`;
  const r = await fetch(url, { headers: authHeaders(secret) });
  const j = await r.json();
  const items = (j?.Data?.Items ?? []).map((it) => ({
    title: it.Title,
    url: it.Url,
    summary: it.Summary,
    thumbnail: it.ThumbnailUrl,
  }));
  await cacheSet(ck, items, ttl);
  return items;
}

// ---------- 3. 知乎直答（大模型，OpenAI 兼容格式：POST {OPENAI_BASE_URL}/chat/completions） ----------
// topic 用于「跨用户 topic 级缓存」：同一话题不同处境卡可复用首次结果，吸收冷门话题慢响应
export async function zhihuZhida(secret, prompt, model = OPENAI_MODEL, ttl = 600, topic = '') {
  if (!hasSecret(secret)) return MOCK.zhida(prompt);
  // 1) 先查 topic 级缓存（跨用户复用），命中即返回，避免重复慢请求
  const topicKey = topic ? `zhida:${model}:t:${hash(topic)}` : null;
  if (topicKey) {
    const th = await cacheGet(topicKey);
    if (th) return th;
  }
  // 2) 再查完整 prompt 缓存（个性化复用）
  const ck = `zhida:${model}:${hash(prompt)}`;
  const hit = await cacheGet(ck);
  if (hit) return hit;
  try {
    const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(secret),
      // 直答偶发慢响应：放宽到 40s 给足时间（实测常 20~35s 才返回），超时再返回空串交由上层重试/兜底
      signal: AbortSignal.timeout(40000),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    // 状态异常时先读文本，避免非 JSON 错误体直接抛到外层
    const rawText = await r.text();
    if (!r.ok) {
      console.error('[zhida] HTTP error', r.status, rawText.slice(0, 200));
      return '';
    }
    const j = JSON.parse(rawText);
    const text = j?.choices?.[0]?.message?.content ?? '';
    // 双向回写：个性化 prompt 缓存 + topic 级缓存（吸收同话题后续请求）
    await cacheSet(ck, text, ttl);
    if (topicKey) await cacheSet(topicKey, text, ttl);
    return text;
  } catch (err) {
    console.error('[zhida] error', err?.name || err?.message || err);
    return '';
  }
}

// ---------- 3.4 额度查询（免费接口，不消耗直答/热榜额度） ----------
// 用于 /api/health 健康检查与配额提示；官方未给稳定 schema，做防御性解析
export async function zhihuQuota(secret) {
  if (!hasSecret(secret)) return { ok: false, reason: 'no-secret' };
  const ck = 'quota';
  const cached = await cacheGet(ck);
  if (cached) return cached;
  try {
    const r = await fetch(`${API_BASE}/api/v1/quota`, { headers: authHeaders(secret), signal: AbortSignal.timeout(10000) });
    const rawText = await r.text();
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, raw: rawText.slice(0, 200) };
    let data;
    try { data = JSON.parse(rawText); } catch { data = rawText.slice(0, 200); }
    // 业务码防御（工单 t/12；06 实测 schema：有效={Code:0,Message:"success",Data:[...]}，无效=HTTP 200 + {Code:20001,"Authorization failed",Data:null}）：
    // HTTP 200 不代表鉴权通过——解析出对象且含数值型（或数字字符串）Code 且 !==0 即业务错误，不得谎报 ok（否则 /api/health reachable 谎报 true）。
    // Code===0（含 "0"）、无 Code 字段或 Code 非数值 → 保持旧行为。失败结果不写缓存（仅成功才 cacheSet）。
    if (data && typeof data === 'object' && data.Code !== undefined && data.Code !== null) {
      const c = data.Code;
      const numeric = typeof c === 'number'
        || (typeof c === 'string' && c.trim() !== '' && !Number.isNaN(Number(c)));
      if (numeric && Number(c) !== 0) {
        return { ok: false, reason: `business-error Code:${c}`, raw: rawText.slice(0, 200) };
      }
    }
    const result = { ok: true, data };
    await cacheSet(ck, result, 300);
    return result;
  } catch (err) {
    return { ok: false, reason: err?.message || 'network error' };
  }
}

// ---------- 3.5 简历解析（模块③）----------// 输入：简历纯文本（前端已从 PDF/DOCX/TXT 提取）；输出：结构化字段
// 优先用 StepFun（阶跃星辰）解析，即使没有知乎 Secret 也能真解析；
// 若 StepFun 也未配置，则回退知乎直答（若有 secret）；都没有则返回失败由前端手动填写
export async function extractResume(secret, text) {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  const prompt = `你是简历信息提取器。请从下面这段简历文本中提取结构化字段，只输出 JSON，不要解释。
要求：
1. 尽可能详细，不要合并成一句话；学校、公司、项目、技能尽量分别列出。
2. 如果某个字段实在没有信息，用空字符串或空数组，不要编造。
字段：
- name: 姓名（字符串，未找到留空）
- phone: 手机号（字符串）
- email: 邮箱（字符串）
- city: 当前/目标城市（字符串）
- education: 教育经历摘要（学校/专业/学历/时间，如有多段用分号分隔）
- experience: 工作或项目经历摘要（公司/角色/做了什么；多段用分号分隔）
- projects: 项目经历数组（每个元素包含 name 项目名、role 角色、highlights 亮点数组，没有则空数组）。【重要】把简历里每一个独立项目都拆成数组中的一条，不要合并成一句话；如果项目经历混在 work experience 里，也要单独抽出来逐条列出。
- skills: 技能列表（数组，如 Python、Go、Kubernetes）
- skillLevels: 技能熟练度对象（可选，如 {"Python":"熟练","Go":"了解"}）
- industry: 推断所在或目标行业（如 AI、金融、传媒）
- roles: 推断岗位方向（数组，如 算法工程师、后端开发）
- salary: 薪资期望或当前薪资（字符串，未找到留空）
- certs: 证书数组（如 英语六级、PMP）
- languages: 语言能力数组（如 英语、日语）
- summary: 一句话人才画像（50 字以内）
JSON 示例：{"name":"","phone":"","email":"","city":"","education":"","experience":"","projects":[],"skills":[],"skillLevels":{},"industry":"","roles":[],"salary":"","certs":[],"languages":[],"summary":""}
简历文本：
${text.slice(0, 14000)}`;

  // 1) 优先 StepFun（独立于知乎 secret）
  if (STEPFUN_KEY && STEPFUN_KEY.trim()) {
    const raw = await stepfunChat(prompt);
    if (raw && raw.trim()) {
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        const json = m ? JSON.parse(m[0]) : {};
        return { ok: true, fields: json, provider: 'stepfun' };
      } catch {
        return { ok: false, reason: 'parse-fail', fields: {} };
      }
    }
    return { ok: false, reason: 'llm-empty', message: 'StepFun 返回为空，可能是密钥无效或网络问题', fields: {} };
  }

  // 2) 回退：知乎直答（需要知乎 secret）
  if (hasSecret(secret)) {
    const raw = await zhihuZhida(secret, prompt, OPENAI_MODEL, 86400);
    if (!raw) return { ok: false, reason: 'llm-empty', fields: {} };
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      const json = m ? JSON.parse(m[0]) : {};
      return { ok: true, fields: json, provider: 'zhihu' };
    } catch {
      return { ok: false, reason: 'parse-fail', fields: {} };
    }
  }

  // 3) 都没配置
  return { ok: false, reason: 'no-secret', message: '未配置任何 LLM 密钥（StepFun / 知乎），无法解析简历，请手动填写背景摘要', fields: {} };
}

// ---------- 检索权重：分源归一化打分（分开排名再合并） ----------
// 实测事实：全网搜索结果的 voteUp/comment 恒为 0（网页没有点赞这回事）。
// 若跨源直接比赞数，全网会被永久压在最后，"知乎没有的冷门话题靠全网补位"就会失效。
// 因此：站内按「权威等级为主 + 赞数/评论加分」，全网只按「权威等级」，各自排名后再按配额合并。
// authority 实测为字符串数字 "2"/"3"/"4"（数字越大越权威），此前从未被使用。
const AUTHORITY_FALLBACK = 2; // authority 缺失时按中等等级处理，避免被误判为最低
function authorityOf(it) {
  const n = Number(it && it.authority);
  return Number.isFinite(n) && n > 0 ? n : AUTHORITY_FALLBACK;
}
export function scoreItem(it) {
  if (!it) return 0;
  const auth = authorityOf(it);
  if (it.source === 'web') return auth * 10; // 全网没有赞数信号，只看权威等级
  const vu = Number(it.voteUp) || 0;
  const cm = Number(it.comment) || 0;
  return auth * 10 + Math.log10(vu + 1) * 3 + Math.log10(cm + 1);
}

// 从用户问题里抽取中文关键词（2~4 字滑动窗口），用于给相关搜索结果加权
function topicKeywords(topic) {
  if (!topic) return [];
  const stop = /能养活自己吗|能不能|怎么|如何|吗|呢|是不是|有没有|到底|为什么|是否|该不该|值得|适合|转行|做|干|搞|入行|？|\?|！|。|，|、|怎么才能|可以吗|行不行|靠谱吗|前景|现状|好吗|难吗/g;
  const t = String(topic).replace(stop, ' ').trim();
  const segs = t.match(/[一-龥]{2,}/g) || [];
  const set = new Set();
  segs.forEach((s) => {
    const maxLen = Math.min(4, s.length);
    for (let len = 2; len <= maxLen; len++) {
      for (let i = 0; i + len <= s.length; i++) set.add(s.slice(i, i + len));
    }
  });
  return [...set];
}

// 检测 GBK/UTF-8 乱码：出现日文假名/韩文/连续生僻扩展区字符，基本就是解码错误
function looksMojiboke(s) {
  if (!s) return false;
  const t = String(s);
  if (/[\u3040-\u30ff\uac00-\ud7af]/.test(t)) return true;
  const rare = t.match(/[\u3400-\u4dbf\u{20000}-\u{2a6df}]/gu) || [];
  return rare.length >= 3;
}

// 清洗作者名：去掉地点、发布者、编辑等无意义标签，以及带冒号/书名号的脏名
function cleanAuthor(name, isWeb, url) {
  let n = String(name || '').trim().replace(/[：:|《》<>"]/g, '');
  const badSet = new Set([
    '知乎答主','全网来源','匿名用户','网友','编辑','小编','作者','发布者','发布者：',
    '北京','上海','天津','重庆','河北','山西','辽宁','吉林','黑龙江','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','海南','四川','贵州','云南','陕西','甘肃','青海','台湾','内蒙古','广西','西藏','宁夏','新疆','香港','澳门',
    '浙江省','山东省','广东省','北京市','上海市','天津市','重庆市',
  ]);
  const isBad = !n || n.length < 2 || n.length > 15 || badSet.has(n) || /^(\d+|[^\u4e00-\u9fa5a-zA-Z0-9_·\.]+$)/.test(n) || /省$|市$|自治区$/.test(n);
  if (!isBad) return n;
  if (isWeb && url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '').split('.')[0];
      if (host && host.length >= 2 && host.length <= 15) return host;
    } catch { /* ignore */ }
  }
  return isWeb ? '全网来源' : '知乎答主';
}

// HTML 实体简单解码，避免标题里出现 &nbsp;&quot; 这类东西
function decodeHtmlEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#[0-9]+;/g, (m) => { try { return String.fromCodePoint(parseInt(m.slice(2, -1), 10)); } catch { return m; } })
    .replace(/&#x[0-9a-fA-F]+;/g, (m) => { try { return String.fromCodePoint(parseInt(m.slice(3, -1), 16)); } catch { return m; } });
}

// 去重 + 分源排名 + 配额合并（知乎为主体，全网最多占 1/4 补位）；topic 相关项加权，确保用户所问主题不被高热度无关话题挤出
export function pickCorpus(items, total = 8, topic = '') {
  const list = Array.isArray(items) ? items : [];
  const kws = topicKeywords(topic);
  const best = new Map(); // 同一标题保留分数最高的一条（跨源同样适用）
  list.forEach((it) => {
    const t = normTitle(it.title);
    if (!t) return;
    let s = scoreItem(it);
    if (kws.length) {
      const text = (it.title || '') + ' ' + (it.summary || '');
      if (kws.some((k) => text.includes(k))) s += 100; // 主题相关大幅加权
    }
    const cur = best.get(t);
    if (!cur || s > cur.s) best.set(t, { it, s });
  });
  const arr = [...best.values()].sort((a, b) => b.s - a.s);
  const uniq = arr.map((x) => x.it);
  const byScore = (a, b) => scoreItem(b) - scoreItem(a);
  const zhihuItems = uniq.filter((it) => it.source !== 'web').sort(byScore);
  const webItems = uniq.filter((it) => it.source === 'web').sort(byScore);
  // 知乎占主体：全网最多占 1/4；但知乎结果本身很少时，全网数量进一步压到不超过知乎，
  // 避免"知乎只有 2 条、全网却填满"导致展示里全网反而过半（用户原话：知乎少、全网多）
  const maxWebByTotal = Math.floor(total * 0.25);
  let takeWeb, takeZh;
  if (zhihuItems.length === 0) {
    takeWeb = Math.min(webItems.length, total);
    takeZh = 0;
  } else {
    takeWeb = Math.min(webItems.length, maxWebByTotal);
    takeZh = Math.min(zhihuItems.length, total - takeWeb);
    if (takeWeb >= takeZh) {
      takeWeb = Math.min(takeWeb, Math.max(0, takeZh - 1));
      takeZh = Math.min(zhihuItems.length, total - takeWeb);
    }
  }
  const corpus = [...zhihuItems.slice(0, takeZh), ...webItems.slice(0, takeWeb)];
  const sources = [...zhihuItems.slice(0, Math.min(zhihuItems.length, 5)), ...webItems.slice(0, 1)].slice(0, 6);
  return { corpus, sources, zhihuItems, webItems, zhihuChosen: takeZh, webChosen: takeWeb };
}

// ---------- 4. 判断力炼金包：搜索 + 直答 组合（核心） ----------
// 多角色对照（B1 伪多 Agent）：单次调用产出多个有独立人设的虚拟答主，各自基于知乎内容给视角并互相质疑。
// 不综合结论，保留张力；单次调用零额外额度消耗。
// persona = { identity, industry, sub }（由前端 src/lib.js 的 personaPayload 提供）
export async function alchemy(secret, topic, persona = { identity: 'pre', industry: 'ai', sub: 'AIGC' }, queries = [], records = []) {
  if (!hasSecret(secret)) return MOCK.alchemy(topic, persona); // 演示模式：返回精美示例，保证"打开即完整"
  const pt = (typeof persona === 'string')
    ? { identity: 'pre', industry: 'ai', sub: 'AIGC', prompt: '' }
    : persona;
  // 归一化：新处境卡字段（stageName/goalNames）映射到旧字段名，供 topicMock / prompt 模板兼容
  pt.identityName = pt.stageName || pt.identityName || ({ pre: '准入行', grad: '应届求职', unemployed: '待业求职', watch: '在职观望', deepen: '在职深耕', shift: '转行转岗', offer: 'Offer决策' }[pt.stage] || pt.identity || '准入行');
  pt.industryName = pt.industryName || pt.industry;
  pt.subName = pt.subName || pt.sub;
  const personaPrompt = pt.prompt || `你是「${pt.identityName}」的人，行业「${pt.industryName}」，细分「${pt.subName}」。`;
  // 模块④：检索词结合处境卡（站内 + 全网双路并发检索，补知乎单一来源短板；各自 15s 超时，单路失败不影响整体）
  const qs = (queries && queries.length) ? queries.slice(0, 5) : [topic];
  const searchResults = await Promise.allSettled([
    ...qs.map((q) => zhihuSearch(secret, q, 6)),
    ...qs.map((q) => zhihuGlobalSearch(secret, q, 6)),
  ]);
  let items = [];
  searchResults.forEach((r) => { if (r.status === 'fulfilled' && Array.isArray(r.value)) items = items.concat(r.value); });
  // 去重 + 权重选料：知乎为主体（占 3/4），全网补位（占 1/4）；一方不足时名额让给另一方
  const picked = pickCorpus(items, 10, topic);
  const { zhihuItems, webItems } = picked;
  items = picked.corpus; // 兜底/补全/来源分配都复用这份精选语料，保证展示的来源和喂给模型的一致
  const corpus = picked.corpus
    .map((it, i) => `【来源${i + 1}·${it.source === 'web' ? '全网' : (it.voteUp || 0) + '赞'}】${it.title}\n${it.summary}`)
    .join('\n\n');

  const contextLines = [
    pt.stageName ? `用户当前阶段：${pt.stageName}` : '',
    (pt.goalNames && pt.goalNames.length) ? `用户目标：${pt.goalNames.join('、')}` : '',
    pt.city ? `目标城市：${pt.city}` : '',
    pt.timePressure ? `时间压力：${pt.timePressure}` : '',
    pt.confusion ? `用户当前最困惑：${pt.confusion}` : '',
    pt.education ? `用户背景摘要：${pt.education}` : '',
  ].filter(Boolean);
  const contextBlock = contextLines.length ? `\n用户处境卡（用于让回答贴合此人，而非泛泛而谈）：\n${contextLines.map((l) => '- ' + l).join('\n')}\n` : '';
  // 决策B：接入历史炼金包（只带与本次问题相关的，防串味；无关则完全忽略）
  const selected = selectHistory(topic, records);
  const historyBlock = buildHistoryBlock(selected);

  const prompt = `你是一个"判断力陪练"教练，而不是总结机器。${personaPrompt}${contextBlock}${historyBlock}
围绕主题"${topic}"，基于下面来自知乎真实高赞讨论的内容，帮这个具体身份的人看清分歧、长出自己的判断。

严格要求：只返回一个 JSON 对象，不要任何额外文字、不要 markdown 代码块。

{
  "topic": "一句话主题",
  "conflict": {
    "summary": "一句话说明分歧为何对这个人真实存在",
    "roles": [
      {
        "id": "r1",
        "name": "【谁在说】贴合该行业真实身份的一句身份，必须是'人'，不能是文章标题/问题/知乎链接/观点摘要。例：一线算法面试官 / 转型成功的双非量化研究员 / 做了5年医药代表的一线销售。禁止：'大厂校招狂卷AI应届生懵了 - 知乎' 这类搜索结果标题、'如何看待…' 这类问句、'某高赞回答' 这类泛称。不要加「刘看山」之类虚构前缀。",
        "form": "形态标签",
        "avatar": "🐻‍❄️",
        "persona": "一句话背景",
        "stance": "核心立场短句",
        "coreArg": "最强论点，落到「${pt.industryName || pt.industry}·${pt.subName || pt.sub}」具体场景",
        "bestFor": "最适合哪类人",
        "boundary": "边界与前提",
        "matchReason": "为什么匹配用户处境卡",
        "sources": ["来源1"],
        "rebuts": [{"to": "r2", "text": "对另一角色的具体质疑"}]
      }
    ]
  },
  "framework": {
    "title": "信谁框架",
    "dimensions": [{"dim": "维度名", "guide": "具体怎么用"}]
  },
  "quiz": [
    {"scenario": "情境题1：直接来自用户最困惑的问题，测试第一反应更接近哪一派", "options": [{"label": "用 r1 角色真实立场缩写的具体选项", "side": "r1"}, {"label": "用 r2 角色真实立场缩写的具体选项", "side": "r2"}, {"label": "用 r3 角色真实立场缩写的具体选项", "side": "r3"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"},
    {"scenario": "情境题2：识别某派观点的边界/前提，什么时候它不成立", "options": [{"label": "用 r1 角色真实立场缩写的具体选项", "side": "r1"}, {"label": "用 r2 角色真实立场缩写的具体选项", "side": "r2"}, {"label": "用 r3 角色真实立场缩写的具体选项", "side": "r3"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"},
    {"scenario": "情境题3：判断不同角色互驳时，哪条质疑最有力", "options": [{"label": "用 r1 角色真实立场缩写的具体选项", "side": "r1"}, {"label": "用 r2 角色真实立场缩写的具体选项", "side": "r2"}, {"label": "用 r3 角色真实立场缩写的具体选项", "side": "r3"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"},
    {"scenario": "情境题4：哪条论据最弱、最依赖未经验证的前提", "options": [{"label": "用 r1 角色真实立场缩写的具体选项", "side": "r1"}, {"label": "用 r2 角色真实立场缩写的具体选项", "side": "r2"}, {"label": "用 r3 角色真实立场缩写的具体选项", "side": "r3"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"},
    {"scenario": "情境题5：在用户的城市/时间压力/背景下，该优先采信哪一派建议", "options": [{"label": "用 r1 角色真实立场缩写的具体选项", "side": "r1"}, {"label": "用 r2 角色真实立场缩写的具体选项", "side": "r2"}, {"label": "用 r3 角色真实立场缩写的具体选项", "side": "r3"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"}
  ],
  "actions": [
    {"when": "今天", "hypothesis": "要验证的关键判断（一句话、可被事实推翻）", "where": "去哪儿做：具体平台/渠道+搜什么关键词", "steps": "怎么操作：一步步、带明确数字（看几个/约几个人/列几份）", "done": "做完算不算成：交付什么、怎么算做成", "goSignal": "出现这些说明该坚持", "stopSignal": "出现这些说明该收手/换路", "role": "r1"},
    {"when": "本周内", "hypothesis": "要验证的关键判断", "where": "去哪儿做：具体平台/渠道+搜什么关键词", "steps": "怎么操作：一步步、带明确数字（看几个/约几个人/列几份）", "done": "做完算不算成：交付什么、怎么算做成", "goSignal": "出现这些说明该坚持", "stopSignal": "出现这些说明该收手/换路", "role": "r2"},
    {"when": "本月结束前", "hypothesis": "要验证的关键判断", "where": "去哪儿做：具体平台/渠道+搜什么关键词", "steps": "怎么操作：一步步、带明确数字（看几个/约几个人/列几份）", "done": "做完算不算成：交付什么、怎么算做成", "goSignal": "出现这些说明该坚持", "stopSignal": "出现这些说明该收手/换路", "role": "r3"},
    {"when": "三个月内", "hypothesis": "要验证的关键判断", "where": "去哪儿做：具体平台/渠道+搜什么关键词", "steps": "怎么操作：一步步、带明确数字（看几个/约几个人/列几份）", "done": "做完算不算成：交付什么、怎么算做成", "goSignal": "出现这些说明该坚持", "stopSignal": "出现这些说明该收手/换路", "role": "r1"}
  ]
}

约束：只返回 JSON；roles 2~4 个；每个角色 name 必须是"谁在说"的真实身份（严禁用文章标题/问句/链接/泛称当名字，见上文 name 字段说明）；每个角色必须有 matchReason 和至少 1 条 sources；rebuts 至少质疑另一角色；内容紧紧围绕用户的问题（主题）展开，绝不要套用建档行业的默认设定。不同角色引用的 sources 尽量不要重复；若真实来源不足，宁可让角色少引一篇，也不要把同一篇文章硬塞给多个角色。quiz 必须包含 5 道题，分别测：1)第一反应/本能立场；2)边界识别（什么时候某派不成立）；3)互驳判断（哪条质疑最有力）；4)论据可信度（哪条最依赖未验证前提）；5)处境取舍（在目标城市/时间压力/背景下该优先采信谁）。每题 options 数量必须与 roles 数量一致，side 用角色 id（r1/r2/r3...）；【关键】每题的每个选项 label 必须是"该选项对应角色的真实立场"的缩写（直接引用该角色的 stance / coreArg 要点），禁止 5 道题用同一套模板化文案，禁止出现"支持A派/反对B派"这类空泛标签，每题的 option 文案必须因题而异、各自体现对应派的真实观点；必须有 feedback 和 analysis，不要有 correctSide 这种标准答案字段；quiz 第 1 题的情境必须直接来自用户最困惑的问题与真实处境，而非通用话术。行动地图必须给出 4~6 条 action，每条用「when / hypothesis / where / steps / done / goSignal / stopSignal / role」八字段：when=时间窗口（结合时间压力：短于一星期用"2小时内/今天/本周"，一个月左右用"今天/本周/本月"，三个月以上用"本周/本月/三个月内"，未填时首条必须"明确时间窗口"）；hypothesis=要验证的一个关键判断（一句话、可被事实推翻）；where=去哪儿做（具体平台/渠道+搜什么关键词，如 BOSS直聘·搜"数据分析师"）；steps=怎么操作（一步步、带明确数字，如"找 3 个岗位→抄硬性要求→逐条对照"）；done=做完算不算成（交付什么、怎么算做成，可验证的产出物）；goSignal=出现哪些信号说明该坚持；stopSignal=出现哪些信号说明该收手/换路；role=该任务主要服务验证哪一派（角色 id r1/r2/... 或 "all"），至少让不同角色都有对应任务。

内容：
${corpus || '（无检索结果，请基于该行业常识生成）'}`;

  // matchReason 模板用模块级 matchReasonFor（11b 从此处的局部 helper 提升：topicMock 源头也需复用）

  // 调用直答：最多重试 3 次，总耗时受 ALCHEMY_BUDGET 全局预算约束，超预算立即走真实数据兜底（绝不干等/前端超时）
  let json = null;
  let roles = [];
  const ALCHEMY_BUDGET = 44000; // 直答阶段最长占用（ms）；单次直答超时已放宽到 40s，预留一次重试；叠加搜索（~12s）整体最坏 ~56s，前端 70s 超时内必返回
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() - startedAt > ALCHEMY_BUDGET) {
      console.warn('[alchemy] zhida budget exceeded, skip remaining attempts -> fallback');
      break;
    }
    const aug = attempt === 0
      ? prompt
      : prompt + '\n\n（务必只返回合法 JSON，且 conflict.roles 至少 2 个，每个含 id/name/coreArg/sources/matchReason；不要任何额外文字。）';
    const r = await zhihuZhida(secret, aug, OPENAI_MODEL, 600, topic);
    if (!r || !r.trim()) { console.warn('[alchemy] zhida empty, attempt', attempt); continue; }
    try {
      const parsed = JSON.parse(extractJson(r));
      const rs = linkSources(parsed.conflict?.roles || [], items);
      if (rs && rs.length >= 2) { json = parsed; roles = rs; break; }
      console.warn('[alchemy] zhida returned', rs?.length || 0, 'roles, attempt', attempt);
    } catch (e) {
      console.warn('[alchemy] zhida parse failed, attempt', attempt);
    }
  }

  // 直答彻底失败：用真实搜索结果兜底（绝不退回关键词模板），保证"依靠知乎真实内容"
  if (!json) {
    console.warn('[alchemy] all zhida attempts failed, real-data fallback for', topic);
    return realDataFallback(items, topic, pt, selected);
  }

  // 角色数仍 <2：用真实搜索结果补全（而非模板）
  if (!roles || roles.length < 2) {
    const realRoles = rolesFromItems(items, pt, roles, topic);
    const existingIds = new Set((roles || []).map((r) => r.id).filter(Boolean));
    const padded = [...(roles || [])];
    realRoles.forEach((r) => { if (!existingIds.has(r.id)) { padded.push(r); existingIds.add(r.id); } });
    roles = padded.slice(0, 4);
    json.fallback = true;
  }
  // 角色数超过 4，或超过可用真实来源数时截断，避免同一篇文章被多个角色重复引用
  const maxRoles = Math.max(2, Math.min(4, items.length || 4));
  if (roles.length > maxRoles) {
    roles = roles.slice(0, maxRoles);
    json.lowConfidence = true;
  }

  // 保证每个角色都有 matchReason 和至少 1 条来源（100% 可解释性）
  const goalTxt = (pt.goalNames && pt.goalNames.length) ? pt.goalNames.join('、') : '';
  const usedFallback = new Set();
  roles = roles.map((r, idx) => {
    const name = cleanRoleName(r.name, r.form, idx); // 兜底清洗：模型偶尔把搜索标题/问句当名字，强制改成正常派系名
    const baseReason = `匹配你的处境：阶段「${pt.identityName}」${goalTxt ? ' · 目标「' + goalTxt + '」' : ''}${pt.industryName ? ' · 行业「' + pt.industryName + '·' + pt.subName + '」' : ''}`;
    let reason = r.matchReason || baseReason;
    if (pt.city && !reason.includes('城市')) reason += ` · 城市「${pt.city}」`;
    if (pt.timePressure && !reason.includes('时间')) reason += ` · 时间窗口「${pt.timePressure}」`;
    let srcItems = Array.isArray(r.sourceItems) ? r.sourceItems : [];
    if (!srcItems.length && items.length) {
      // 尽量给不同角色分配不同来源，减少同一篇文章反复出现
      const picks = [];
      const start = idx % items.length;
      for (let k = 0; k < items.length && picks.length < 2; k++) {
        const i = (start + k) % items.length;
        if (!usedFallback.has(i)) {
          usedFallback.add(i);
          picks.push(items[i]);
        }
      }
      while (picks.length < 2 && items.length) {
        picks.push(items[(idx + picks.length) % items.length]);
      }
      srcItems = picks.map((it) => ({
        title: it.title, url: it.url, summary: it.summary, author: it.author, voteUp: it.voteUp,
        source: it.source, authority: it.authority, // 带出来源与权威等级，前端才能标出「知乎/全网」和可信度
      }));
    }
    return { ...r, name, matchReason: reason, sourceItems: srcItems };
  });

  // 行动地图统一成「假设/去做/坚持/收手」六字段结构（兼容旧 task/why），保证前端新 UI 渲染
  if (json && json.actions) json.actions = normalizeActions(json.actions, roles, pt, topic);

  return {
    ok: true, mock: false,
    ...json,
    conflict: { ...(json.conflict || {}), roles },
    usedHistory: selected.map((s) => s.rec.topic), // 本次参考了哪些历史（前端展示用）
    // 来源清单也做站内 + 全网混合，让前端"来源区"直观体现全网搜已接入
    sources: [...zhihuItems.slice(0, 4), ...webItems.slice(0, 2)].slice(0, 6),
  };
}

// 用真实搜索结果构造角色（兜底/补全用，绝不出现关键词模板）
function rolesFromItems(items, pt, existing = [], topic = '') {
  const seed = (existing || []).map((r, i) => ({ ...r, id: r.id || `r${i + 1}` }));
  const usedIds = new Set(seed.map((r) => r.id));
  const usedItemIdx = new Set();
  const out = [...seed];
  // 纯兜底（无已有角色）时，优先把与用户问题相关的素材排到前面，避免答非所问
  let workItems = items;
  if (!existing || existing.length === 0) {
    const kws = topicKeywords(topic);
    if (kws.length) {
      workItems = [...(items || [])].sort((a, b) => {
        const ta = (a.title || '') + ' ' + (a.summary || '');
        const tb = (b.title || '') + ' ' + (b.summary || '');
        const sa = kws.reduce((n, k) => n + (ta.split(k).length - 1), 0);
        const sb = kws.reduce((n, k) => n + (tb.split(k).length - 1), 0);
        return sb - sa;
      });
    }
  }
  (workItems || []).slice(0, 4).forEach((it, i) => {
    const id = `r${i + 1}`;
    if (usedIds.has(id)) return;
    // 给每个角色分配 1~2 条不重复的真实来源；知乎为主体：先保证 1 条知乎，再补 1 条全网
    const picks = [];
    // 1) 先补 1 条知乎
    for (let k = 0; k < workItems.length && picks.length < 1; k++) {
      const idx = (i + k) % workItems.length;
      if (!usedItemIdx.has(idx) && (workItems[idx].source || 'zhihu') !== 'web') {
        picks.push(workItems[idx]); usedItemIdx.add(idx);
      }
    }
    // 2) 再补 1 条全网（不同索引）
    for (let k = 0; k < workItems.length && picks.length < 2; k++) {
      const idx = (i + k) % workItems.length;
      if (!usedItemIdx.has(idx) && (workItems[idx].source || 'zhihu') === 'web') {
        picks.push(workItems[idx]); usedItemIdx.add(idx);
      }
    }
    // 3) 还没凑够 2 条就随便补
    for (let k = 0; k < workItems.length && picks.length < 2; k++) {
      const idx = (i + k) % workItems.length;
      if (!usedItemIdx.has(idx)) { picks.push(workItems[idx]); usedItemIdx.add(idx); }
    }
    const mainIt = picks[0] || it;
    const titleBrief = briefText(mainIt.title, 50) || '相关讨论';
    const summaryBrief = briefText(mainIt.summary, 120) || '';
    const rawTitle = String(mainIt.title || '').trim();
    // 只要标题像问题（含问号/如何/怎样/吗/呢），就用摘要当立场，避免把问题标题硬塞成观点
    const isQuestion = /[?？]/.test(rawTitle) || /如何|怎样|怎么|吗|呢|为什么/.test(rawTitle);
    const stance = summaryBrief
      ? (isQuestion ? `该答主认为：${summaryBrief}` : `该答主分享：${summaryBrief}`)
      : titleBrief;
    const isWeb = mainIt.source === 'web';
    // name：优先用真实作者；名字太脏（知乎答主/全网来源/域名等）时回退到一组有区分度的派系标签，避免所有角色都叫"知乎答主"导致自测题选项雷同
    const authorName = cleanAuthor(mainIt.author, isWeb, mainIt.url);
    const niceAuthor = (authorName && !/(知乎答主|全网来源|全网|答主|来源)/.test(authorName) && authorName.length <= 12) ? authorName : '';
    const PERSONA_LABELS = ['一线从业者', '资深从业者', '行业观察者', '过来人', '招聘方', '转行亲历者'];
    const name = niceAuthor || PERSONA_LABELS[i % PERSONA_LABELS.length];
    const formTag = isWeb ? '全网来源' : '知乎答主';
    // 边界：点出该观点的局部前提，比"个人观点"具体
    const boundary = summaryBrief
      ? `该观点来自${formTag}「${authorName}」的局部经验，主要反映 ta 的城市、资历、客户群体；换个人结果可能不一样。`
      : '该观点来自单一来源，需结合你自己的城市、资历和处境判断。';
    out.push({
      id,
      name: authorName,
      form: formTag,
      side: '',
      avatar: '🐻‍❄️',
      persona: `来自${isWeb ? '全网' : '知乎'}真实讨论：${briefText(mainIt.title, 80)}`,
      stance,
      coreArg: summaryBrief || titleBrief,
      bestFor: `关注「${topic.slice(0, 16)}」真实经验的人`,
      boundary,
      matchReason: matchReasonFor(pt),
      sources: [`来源${i + 1}`],
      sourceItems: picks,
      rebuts: [],
    });
    usedIds.add(id);
  });
  // 为每个角色补一条互驳：用下一角色的立场来质疑当前角色，让交锋区不空
  out.forEach((r, i) => {
    const next = out[(i + 1) % out.length];
    if (next && next.id !== r.id) {
      const nextStance = briefText(next.stance || next.coreArg, 80);
      r.rebuts = [{
        target: next.id,
        quote: `但 ${next.name || next.id} 提醒：${nextStance}。这说明「${r.name || r.id}」的乐观判断未必适用于所有人。`,
      }];
    }
  });
  return out;
}

// 从用户问题里提取一个具体方向词（如"瑜伽师赚钱"/"做陶瓷"），优先于建档行业，避免问瑜伽却生成 AIGC 的行动
function topicDirection(topic, pt) {
  const t = String(topic || '').trim()
    .replace(/[?？!！。，,、.;；\s]/g, '')
    .replace(/[吗呢]$/, '');
  if (t.length >= 2 && t.length <= 10) return t;
  if (t.length > 10) return t.slice(0, 10);
  return pt?.subName || pt?.industryName || '这个方向';
}

// 根据处境卡的时间压力，给兜底行动地图生成「决策验证路线」：
// 每条 = 一个关键假设 + 具体小事 + 坚持信号 + 止损信号（借鉴 career-compass 的"停止条件"与 career-decision-frameworks 的"信号"思想）
function fallbackActions(topic, pt, rolesLen, bias) {
  const city = pt.city || '';
  const tp = String(pt.timePressure || '').trim();
  const dir = topicDirection(topic, pt); // 用用户问题里的方向词，而不是建档行业 AIGC
  // 若带了自测反馈（最信哪派 / 哪些盲区），把对应角色排到前面，让兜底行动也贴合辨向
  const pool = [];
  if (bias && bias.dominantId) pool.push(bias.dominantId);
  if (bias && bias.uncertain && bias.uncertain.length) pool.push(...bias.uncertain);
  const rest = [];
  for (let k = 1; k <= Math.max(1, rolesLen); k++) { const id = `r${k}`; if (!pool.includes(id)) rest.push(id); }
  const allRoles = [...pool, ...rest];
  const roleFor = (i) => allRoles[i % allRoles.length];
  const citySuffix = city ? `${city}本地` : '';

  // 时间压力分桶：紧急(<1周) / 短期(月内) / 长期(>3个月或没填)
  let bucket = 'long';
  if (/周|天|马上|立即|立刻|急|尽快|24\s*小|今晚|这周|两天/.test(tp)) bucket = 'urgent';
  else if (/月/.test(tp)) bucket = 'short';

  const mk = (when, hypothesis, action, go, stop, role) => ({ when, hypothesis, action, goSignal: go, stopSignal: stop, role });
  let core = [];
  if (bucket === 'urgent') {
    core = [
      mk('接下来 2 小时',
        `假设：你能先用"判断草稿"逼自己表态，而不是继续纠结`,
        `写下"如果必须今晚做决定，我会选哪一派、凭什么"的判断草稿（哪怕很粗糙），并标出最没把握的 1 个前提`,
        `写完后发现"其实我心里早有倾向，只是缺证据"，说明你已能决策，下一步只是补证据`,
        `写完仍完全无从下手、每个前提都不确定，说明信息太少，先别硬决定，今明两天去拿一手事实`,
        roleFor(0)),
      mk('今天',
        `假设：一手事实比反复纠结更能帮你判断`,
        `用 30 分钟找到 1 个能验证或推翻你当前偏向的事实（一个电话 / 一份 JD / 一个数据${citySuffix ? '，优先' + citySuffix : ''}）`,
        `若这个事实明显支持或反驳你的偏向，说明你离结论更近一步`,
        `若查了一圈发现"两边都有理、都没实锤"，说明这是价值观取舍而非事实问题，改用"10 年后会不会后悔"来判`,
        roleFor(1)),
      mk('本周',
        `假设：外部视角能帮你堵住拍脑袋的漏洞`,
        `向 1 位可信的人（同事 / 导师 / 行业朋友）口述你的判断，请他挑 1 个漏洞`,
        `若对方点出的漏洞你能补上，说明判断基本站得住`,
        `若对方一句话就戳穿核心前提，说明方向可能错了，回来重做草稿`,
        roleFor(2)),
      mk('本周',
        `假设：你能在${dir}这件事上找到一个"最小可验证动作"`,
        `用 1 小时做 1 件最小验证（发 1 条求职咨询 / 打 1 个电话 / 查 1 个真实岗位${citySuffix ? '，优先' + citySuffix : ''}），记录对方的原话`,
        `若得到明确肯定或否定信号，说明判断已被验证`,
        `若对方回应模糊、没有下一步可落地动作，说明信息渠道不对，换个人或换平台再问`,
        roleFor(3)),
    ];
  } else if (bucket === 'short') {
    core = [
      mk('今天',
        `假设：你的现有背景在"${dir}"岗是「懂业务 / 能落地」的加分项，而不是致命硬伤`,
        `花 20 分钟，在${citySuffix || '招聘网站'}搜 5 个"${dir}"真实 JD，把出现最多的 3 个硬性要求（学历 / 工具 / 项目类型）列出来，对照你已有背景打勾，看重合多少`,
        `若 3 份以上 JD 写"有行业经验优先""懂业务方沟通"，或有人愿意给你面试，说明背景是加分`,
        `若 JD 几乎都硬性要求计算机本科 + 算法基础，且打听下来"没技术底子很难进"，说明硬伤大于加分，得先补技术或换更偏业务的岗`,
        roleFor(0)),
      mk('本周',
        `假设：你能把一个真实业务问题拆成方案——这是"${dir}"的核心能力，不完全靠技术`,
        `用 2 小时做 1 个最小作品：挑一个你熟悉的行业痛点，写 1 页方案（痛点 → ${dir}怎么帮 → 要哪些数据），发给 1 位从业者或发到朋友圈 / 知乎求反馈${citySuffix ? '（优先' + citySuffix + '）' : ''}`,
        `若从业者说"思路对""你抓的点准"，或自己写时不卡壳，说明产品思维你真有`,
        `若连"${dir}能解决什么、不能解决什么"都讲不清，或被指出"这是运营不是产品"，说明还停在表面，先补产品基本功`,
        roleFor(1)),
      mk('本周',
        `假设：市场上有人愿意告诉我这条"${dir}"路的真实通过性，而不是只听成功案例`,
        `通过脉脉 / 知乎 / 校友群${city ? '在' + city + '本地' : ''}约到 2 位正在做"${dir}"的人，问"你当时最难过的那道坎是什么、重来一次会先做哪件事"`,
        `若 2 人都给出具体可复制的动作，且至少有 1 人说"你这种背景有机会"，说明通道真实存在`,
        `若 2 人都说"现在基本不招转行"或建议互相矛盾到无法落地，说明信息不足，先补认知再行动`,
        roleFor(2)),
      mk('本月',
        `假设：我能在公开平台上建立"这个人在认真转${dir}"的可见度，而不只是私下努力`,
        `在知乎/公众号/即刻写一篇「我从现有背景视角看${dir}」的公开笔记，或整理 1 份行业术语表/资源清单发到朋友圈，让至少 3 个业内人士看到`,
        `若有人私信你"写得不错""可以聊聊"，或收到 1 次内推/面试邀约，说明信誉桥开始起作用`,
        `若写完后零互动、且自己觉得"言之无物"，说明输入太少，先停更 2 周，集中读 5 篇高质量文章再做输出`,
        roleFor(3)),
      mk('本月',
        `假设：我能在冲击"${dir}"的同时，给自己留一条"相邻方向"的退路，而不是孤注一掷`,
        `算一笔转行现金流账：现有积蓄能撑几个月无收入？同时列出 2 个与"${dir}"相邻、但门槛更低的岗位方向，并搜${citySuffix || '招聘网站'}有没有这类岗位`,
        `若你能稳 3 个月以上且至少找到 1 个相邻方向有真实岗位，说明风险可控`,
        `若现金流撑不过 2 个月、且完全找不到相邻方向，说明现在裸转风险过高，建议先在职积累或延长过渡期`,
        roleFor(4)),
    ];
  } else {
    core = [
      mk('本周',
        `假设：你先得搞清"${dir}"这行到底要什么样的人，判断才不会跑偏`,
        `针对"${dir}"列出 3 个你必须搞清的关键问题（例如：这行到底缺什么样的人、你的背景能平移哪些能力、缺口怎么补），并各写 1 句你现在的猜测`,
        `若列完发现"其实我能答上 2 个"，说明你离入行不远`,
        `若 3 个都答不上、且查资料也模糊，说明你还没摸到门道，先系统补 2 周行业认知`,
        roleFor(0)),
      mk('本月',
        `假设：系统补知识比盲目行动更能缩短转行周期`,
        `选 1 门"${dir}"入门级课程或 1 本被多次提及的书，用 2 周完成，并输出 1 份学习笔记（可公开发布也可只给 1 位从业者看）`,
        `若学完后你能用新术语重新描述自己的 1 个过往经历，说明知识桥在通`,
        `若学完仍觉得"每个概念都懂但串不起来"，说明课程太浅或方向不对，换一门更偏实战的`,
        roleFor(1)),
      mk('本月',
        `假设：低成本试错 + 公开输出比继续看文章更能告诉你"适不适合"`,
        `做 1 个为期 2 周的最小尝试（副业 / 项目 / 实习${citySuffix ? '，优先' + citySuffix : ''}），并同步在公开平台写 2 篇过程笔记`,
        `若尝试中越来越顺手、且笔记有人互动/咨询，说明这条路值得继续投`,
        `若全程痛苦、拿不到任何正向反馈，说明可能不适合，考虑相邻方向`,
        roleFor(2)),
      mk('三个月内',
        `假设：三个月足够你判断是否正式转向，并为风险做准备`,
        `用这次尝试的反馈决定是否正式转向，并写下 3 条决策理由；同时算清现金流安全垫，列出 2 个相邻方向`,
        `若理由里"能做的证据"多于"想象的恐惧"、且现金流能撑 3 个月以上，说明可以转`,
        `若理由大多是"别人说行""听说赚钱"，或现金流撑不过 2 个月，说明还没到时候，再积累一轮`,
        roleFor(3)),
      mk('三个月内',
        `假设：找到 1 位正在做"${dir}"的过来人，能帮你避开最多盲区`,
        `通过知乎/小红书/校友群${city ? '在' + city + '本地' : ''}约到 1 位做"${dir}"的一线人，请他喝杯咖啡或打 15 分钟电话，问"如果我现在起步，你最建议我先做哪 3 件小事、先别做哪 3 件事"`,
        `若对方给的动作具体可落地，且至少有 1 条和你的想象不一样，说明值回票价`,
        `若对方只能讲宏观趋势、给不出具体动作，或你发现他说的和你网上查的完全一致，说明还没找到真过来人，换渠道再约`,
        roleFor(4)),
    ];
  }

  // 兜底：为每条补上「去哪儿 / 怎么操作 / 完成标准」，让结构完整、前端统一渲染（steps 复用上面已有的 action 文案）
  const whereByBucket = {
    urgent: '纸笔 / 手机备忘录（先逼自己表个态）',
    short: `${city || '招聘网站'} / BOSS直聘 / 脉脉 / 知乎`,
    long: '知乎 / 公众号 / 即刻 / 脉脉 / 校友群',
  };
  const doneByBucket = {
    urgent: '完成标准：写完判断草稿，并标出最没把握的 1 个前提',
    short: '完成标准：拿到至少 1 个可判断的明确信号（肯定或否定都算数）',
    long: '完成标准：产出 1 份可回看的笔记 / 对照表 / 清单',
  };
  core = core.map((a) => ({
    ...a,
    where: whereByBucket[bucket] || whereByBucket.long,
    steps: a.action || '',
    done: doneByBucket[bucket] || doneByBucket.long,
  }));
  return core.slice(0, 5);
}

// 把行动统一成「when / hypothesis / where / steps / done / goSignal / stopSignal / role」八字段结构（兼容旧 task/why/action）
export function normalizeActions(actions, roles, pt, topic) {
  if (!Array.isArray(actions) || !actions.length) return [];
  const roleIds = (roles || []).map((r) => r.id);
  return actions.map((a, i) => {
    const hasNew = a.action || a.hypothesis || a.goSignal || a.stopSignal || a.where || a.steps || a.done;
    const base = hasNew ? a : {
      when: a.when || '',
      hypothesis: a.hypothesis || a.why || '',
      action: a.action || a.task || '',
      goSignal: a.goSignal || '',
      stopSignal: a.stopSignal || '',
      role: a.role || `r${(i % Math.max(1, roleIds.length)) + 1}`,
    };
    const roleOk = base.role === 'all' || (roleIds.length && roleIds.includes(base.role));
    return {
      when: base.when || '',
      hypothesis: base.hypothesis || '',
      where: base.where || '',
      steps: base.steps || base.action || '', // 旧六字段的 action 平滑过渡为 steps
      done: base.done || '',
      goSignal: base.goSignal || '',
      stopSignal: base.stopSignal || '',
      role: roleOk ? base.role : `r${(i % Math.max(1, roleIds.length)) + 1}`,
    };
  });
}

// 角色名兜底清洗：模型偶尔会把搜索结果标题/问题当名字，这里强制改成正常的"谁在说"
function cleanRoleName(name, form, idx) {
  const n = String(name || '').trim();
  const looksLikeTitle = /知乎| - |？|\?|问答|如何看待|怎么|如何|吗|呢|作者|答主|来源|——|：|:|，/.test(n) || n.length > 24;
  if (n && !looksLikeTitle) return n;
  if (form && !/知乎|来源|答主|全网/.test(form) && String(form).length <= 12) return form;
  return `第${idx + 1}派`;
}

// 从 quizResult 抽出主导派与盲区，给 fallbackActions 排序用
function quizBias(qr) {
  if (!qr) return null;
  const dominantArr = qr.dominant || null;
  const dominantId = Array.isArray(dominantArr) ? dominantArr[0] : (dominantArr && dominantArr.top ? dominantArr.top[0] : null);
  return { dominantId, uncertain: qr.uncertainSides || [] };
}

// ---------- 决策B：历史炼金包接入（实体命中判定，防串味） ----------
// 同义词归并：让"换赛道"≈"转行"、"找工作"≈"求职"，避免近义不同词被算成无关
const HISTORY_SYN = [
  ['转行', '换赛道', '跳槽', '转型', '转岗', '换行', '转专业', '跨行'],
  ['求职', '找工作', '应聘', '招聘', '找全职', '找实习', '投简历'],
  ['考研', '升学', '保研', '留学', '读研'],
  ['考公', '公务员', '体制内', '事业单位', '体制'],
  ['副业', '搞钱', '赚钱', '增收', '变现'],
];
const _synMap = (() => { const m = new Map(); HISTORY_SYN.forEach((g) => g.forEach((w) => m.set(w, g[0]))); return m; })();
export function historyKeywords(topic) {
  if (!topic) return new Set();
  const stop = /吗|呢|是不是|有没有|到底|为什么|是否|该不该|值得|适合|怎么|如何|能不能|可以吗|行不行|靠谱吗|前景|现状|好吗|难吗|？|\?|！|。|，|、/g;
  const t = String(topic).replace(stop, ' ').trim();
  const segs = t.match(/[一-龥]{2,}/g) || [];
  const set = new Set();
  segs.forEach((s) => {
    const maxLen = Math.min(4, s.length);
    for (let len = 2; len <= maxLen; len++) for (let i = 0; i + len <= s.length; i++) set.add(s.slice(i, i + len));
  });
  const out = new Set();
  set.forEach((w) => out.add(_synMap.get(w) || w));
  return out;
}
// 选相关历史：当前问题与历史问题共享 ≥1 个核心实体词即算相关，最多带 3 条；零命中则不带（串味从根上防住）
export function selectHistory(topic, records) {
  if (!topic || !Array.isArray(records) || !records.length) return [];
  const cur = historyKeywords(topic);
  if (!cur.size) return [];
  return records
    .filter((r) => r && r.topic && r.topic !== topic)
    .map((r) => {
      const hist = historyKeywords(r.topic);
      let hits = 0;
      cur.forEach((w) => { if (hist.has(w)) hits++; });
      return { rec: r, hits };
    })
    .filter((x) => x.hits >= 1)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3);
}
function histRoleName(roles, id) {
  if (!Array.isArray(roles)) return id;
  return roles.find((x) => x.id === id)?.name || id;
}
function summarizeHistory(rec) {
  const t = rec.topic || '未命名';
  const ts = rec.ts ? new Date(rec.ts) : null;
  const date = ts ? `${ts.getMonth() + 1}/${ts.getDate()}` : '';
  const quiz = rec.quiz || (rec.data && rec.data.quiz) || null;
  const roles = (rec.data && rec.data.conflict && rec.data.conflict.roles) || [];
  let dom = ''; let blind = '';
  if (quiz) {
    const domId = Array.isArray(quiz.dominant) ? quiz.dominant[0] : (quiz.dominant && quiz.dominant.top ? quiz.dominant.top[0] : null);
    if (domId) dom = histRoleName(roles, domId);
    const blinds = (quiz.uncertainSides || []).filter((s) => s !== 'custom');
    if (blinds.length) blind = blinds.map((s) => histRoleName(roles, s)).filter(Boolean).join('、');
  }
  const parts = [];
  if (date) parts.push(date);
  parts.push(`「${t}」`);
  if (dom) parts.push(`最信「${dom}」`);
  if (blind) parts.push(`盲区「${blind}」未补`);
  return parts.join('：');
}
export function buildHistoryBlock(selected) {
  if (!selected || !selected.length) return '';
  const lines = selected.map((s) => `- ${summarizeHistory(s.rec)}`).join('\n');
  return `
你过去炼过的、与本次问题相关的炼金包（★仅供参考；若与本次问题无关，请完全忽略，绝不要被它带偏结论，也不要套用它的行业默认设定）：
${lines}
请据此：① 不要再重复验证用户早已倾向的那一派，直接推进到下一步验证；② 注意用户上次的盲区视角，这次优先补上；③ 若本次与上次判断有出入，在行动里点出「相比上次，你的判断变了 / 没变」。
`;
}

// 根据自测反馈重做行动地图：把"最信哪一派 / 哪些盲区"喂给模型，生成贴合其辨向的验证路线
export async function generateActions(secret, topic, roles, quizResult, persona = {}) {
  const rs = Array.isArray(roles) ? roles : [];
  if (!hasSecret(secret) || !rs.length) {
    return { ok: false, fallback: true, actions: fallbackActions(topic, persona, rs.length, quizBias(quizResult)) };
  }
  const sideCounts = (quizResult && quizResult.sideCounts) || {};
  const uncertain = (quizResult && quizResult.uncertainSides) || [];
  const dominantArr = (quizResult && quizResult.dominant) || null;
  const dominantId = Array.isArray(dominantArr) ? dominantArr[0] : (dominantArr && dominantArr.top ? dominantArr.top[0] : null);
  const roleName = (id) => (rs.find((x) => x.id === id)?.name || id);
  const roleLines = rs.map((r) => `- ${r.id}（${r.name || r.form || r.id}）核心立场：${briefText(r.coreArg || r.stance || '', 60)}`).join('\n');
  const quizSummary = `用户自测结果：最偏向 ${dominantId ? roleName(dominantId) : '未明确'}；标了"不确定"的盲区视角：${uncertain.length ? uncertain.map(roleName).join('、') : '无'}。各派被倾向次数：${Object.entries(sideCounts).map(([k, v]) => `${k}:${v}`).join(', ') || '无'}`;
  const personaPrompt = `用户处境：阶段「${persona.identityName || persona.stageName || ''}」${persona.goalNames && persona.goalNames.length ? ` · 目标「${persona.goalNames.join('、')}」` : ''}${persona.city ? ` · 城市「${persona.city}」` : ''}${persona.timePressure ? ` · 时间「${persona.timePressure}」` : ''}。最困惑：${persona.confusion || topic}。`;
  const prompt = `你是"判断力陪练"。基于下面已经存在的各派立场，以及这位用户刚做完的辨向自测结果，为他生成一份"决策验证路线"（先验证判断、再下结论），每条都在验证一个关键判断，并给"坚持/收手"两把尺子。
${personaPrompt}
已有立场：
${roleLines}
${quizSummary}
严格要求：只返回一个 JSON 对象，不要任何额外文字。
{
  "actions": [
    {"when":"时间窗口","hypothesis":"要验证的关键判断（一句话、可被事实推翻）","where":"去哪儿做：具体平台/渠道+搜什么关键词","steps":"怎么操作：一步步、带明确数字（看几个/约几个人/列几份）","done":"做完算不算成：交付什么、怎么算做成","goSignal":"出现这些说明该坚持","stopSignal":"出现这些说明该收手/换路","role":"该任务主要验证哪一派（角色id或all）"}
  ]
}
约束：给出 4~6 条 action，用 when/hypothesis/where/steps/done/goSignal/stopSignal/role 八字段。where=去哪儿做（具体平台/渠道+搜什么关键词）；steps=怎么操作（一步步、带明确数字，如"找 3 个岗位→抄要求→对照"）；done=做完算不算成（交付什么、可验证的产出物）。必须针对用户的辨向结果：优先验证他"最信的那一派"是否站得住（给 1~2 条 role=${dominantId || 'r1'} 的任务）；针对他标了"不确定"的盲区视角，各给至少 1 条补全任务（role 填对应 id）；其余任务覆盖其他派。时间窗口结合用户时间压力（短于一星期用"2小时内/今天/本周"，一个月左右"今天/本周/本月"，三个月以上"本周/本月/三个月内"，未填则首条"明确时间窗口"）。每条都要具体、可验证、带地点与时间限定，不要泛泛而谈。`;

  const startedAt = Date.now();
  const BUDGET = 15000;
  let json = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() - startedAt > BUDGET) break;
    const r = await zhihuZhida(secret, prompt, OPENAI_MODEL, 600, topic + ':actions');
    if (!r || !r.trim()) continue;
    try {
      const parsed = JSON.parse(extractJson(r));
      if (Array.isArray(parsed.actions) && parsed.actions.length >= 3) { json = parsed; break; }
    } catch {}
  }
  if (!json) return { ok: false, fallback: true, actions: fallbackActions(topic, persona, rs.length, quizBias(quizResult)) };
  const actions = normalizeActions(json.actions, rs, persona, topic);
  return { ok: true, fallback: false, actions };
}

// 检索统筹统计：让前端直观看到「知乎 vs 全网」如何分工、各自贡献多少
function makeSearchStats({ queries, zhihuFound, webFound, zhihuChosen, webChosen, totalChosen, mode }) {
  const isFallback = mode === 'fallback';
  return {
    queries, zhihuFound, webFound, zhihuChosen, webChosen, totalChosen, mode: mode || 'normal',
    rationale: isFallback
      ? '知乎直答这会儿没连上，已切换到「原始山径」模式。下面的知乎与全网结果都保留了原始讨论，没有 AI 再帮你精选整合；哪些和你的处境接近，你就重点看哪些。可信度需要你自己判断。'
      : '知乎站内讨论带真实赞数与权威等级，可信度更高，优先采用；站内不足或冷门话题由全网搜索补位，保证你听到另一种声音。',
  };
}

// 直答彻底失败时的真实数据兜底：仍返回合法结构，内容全部来自真实知乎搜索
// export：供 scripts/fallback-check.mjs 做回归断言（长文截断 + 选项数量）
export function realDataFallback(items, topic, pt, selected = []) {
  const picked = pickCorpus(items, 10, topic); // 先按用户问题相关性加权精选
  // 若与问题直接相关的素材足够，角色就只用这些，彻底排除"建档行业"残留的无关立场
  const kws = topicKeywords(topic);
  let roleItems = picked.corpus;
  if (kws.length) {
    const related = picked.corpus.filter((it) => kws.some((k) => ((it.title || '') + ' ' + (it.summary || '')).includes(k)));
    if (related.length >= 3) roleItems = related;
  }
  const roles = rolesFromItems(roleItems, pt, [], topic).map((r, idx) => ({ ...r, name: cleanRoleName(r.name, r.form, idx) }));
  const dims = [
    { dim: '看高赞但不盲从', guide: '点开下面每篇知乎原文，看高赞答主到底凭什么立论，而非只记结论。' },
    { dim: '看反对与边界', guide: '专门找和你直觉相反的回答，想想它成立的前提是什么。' },
    { dim: '看最新一线实践', guide: '优先读近一年的回答，过时的行业判断可能已经变天。' },
  ];
  const ref = (roles.length ? roles : [{ id: 'r1', name: '知乎答主' }]).slice(0, 3);
  const quizTemplates = [
    { pre: '下面这条真实经验，你的第一反应更接近谁？', fb: '想逼出的盲区：你是在看论证，还是在看立场？', opt: (role) => briefText(role.stance || role.coreArg || role.name, 32) },
    { pre: '这条经验在什么前提下才成立，超出该前提是否就失效？', fb: '想逼出的盲区：你是否把“特定条件下成立”当成了“普遍真理”？', opt: (role) => `只在「${briefText(role.name, 12)}」的局部处境（城市/资历/客户群）下才成立` },
    { pre: '如果只看反对意见，下面哪条对这条经验的质疑最有力？', fb: '想逼出的盲区：你是否只收集支持自己的证据？', opt: (role) => briefText(role.rebuts?.[0]?.quote || `另一派认为：${role.stance || role.coreArg}`, 32) },
    { pre: '这条经验的结论最依赖哪个未经验证的前提？', fb: '想逼出的盲区：你是否把假设当成了事实？', opt: (role) => `前提是：${briefText(role.name, 12)} 的城市、资历、客户群和你差不多` },
    { pre: '结合你的城市/时间压力/背景，这条经验对你当前处境的可借鉴度有多高？', fb: '想逼出的盲区：你是否在照搬别人的处境？', opt: (role) => `若处境和「${briefText(role.name, 16)}」接近，优先听这一派` },
  ];
  const quiz = quizTemplates.map((tpl, i) => {
    const r = ref[i % ref.length];
    const opts = ref.map((role) => ({
      label: tpl.opt(role),
      side: role.id,
    }));
    // 加一个「不确定」选项，让自测不只是二选一
    opts.push({ label: '不确定 / 还没想清楚', side: null });
    return {
      // 题干只给问题，不挂 messy 的文章标题；正文摘要交给「主流观点」卡片
      scenario: `关于"${topic}"，${tpl.pre}`,
      options: opts,
      prompt: '你更倾向哪一边？',
      feedback: tpl.fb,
      analysis: `对照「${briefText(r.name, 20)}」的具体前提再判断。`,
    };
  });

  const lowConfidence = (items || []).length < 3;
  const summary = lowConfidence
    ? `关于"${topic}"，知乎上直接相关的高赞讨论不多，下面这些内容由相近主题的真实回答兜底——你可以把它们当成“旁听素材”，重点看哪些前提和你处境接近。`
    : `关于"${topic}"，知乎上有这些真实高赞讨论，看法并不一致——下面直接来自真实回答。`;

  const zhihuFound = (items || []).filter((it) => (it.source || 'zhihu') !== 'web').length;
  const webFound = (items || []).length - zhihuFound;

  return {
    ok: true, mock: false, fallback: true, lowConfidence,
    topic,
    usedHistory: (selected || []).map((s) => s.rec.topic), // 兜底模式也告诉前端：本次参考了哪些历史（防串味）
    searchStats: makeSearchStats({
      queries: 1,
      zhihuFound,
      webFound,
      zhihuChosen: picked.zhihuChosen,
      webChosen: picked.webChosen,
      totalChosen: picked.corpus.length,
      mode: 'fallback',
    }),
    conflict: { summary, roles },
    framework: { title: '信谁框架（真实数据兜底）', dimensions: dims },
    quiz,
    actions: fallbackActions(topic, pt, roles.length),
    sources: picked.sources,
  };
}

function extractJson(s) {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b >= 0 ? s.slice(a, b + 1) : s;
}

// 兜底内容摘要：取第一句，防长文直接拍在用户脸上
function briefText(s, max = 120) {
  if (!s) return '';
  const t = String(s).trim().replace(/\s+/g, ' ');
  const m = t.match(/^[^。！？.!?]{10,120}[。！？.!?]/);
  if (m) return m[0].slice(0, max);
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// 标题归一化（去重用）：去除所有空白和标点，避免"标题?-知乎"与"标题？-知乎"被当作两篇
function normTitle(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

// 把角色里的"来源N"编号数组映射成真实文章清单（标题/URL/摘要/作者/赞），让每条论点有多篇可点击来源
// 同一篇文章尽量不被多个角色重复引用：若 LLM 给多个角色都写了"来源1"，后续角色会被分配到未使用的来源；
// 若所有来源都已占用，宁可让该角色少一篇，也不重复展示同一篇文章。
function linkSources(roles, items) {
  const used = new Set();
  return (roles || []).map((r) => {
    const refs = Array.isArray(r.sources) ? r.sources : (r.source ? [r.source] : []);
    const rawIdxs = refs
      .map((m) => {
        const mm = String(m).match(/来源\s*(\d+)/);
        return mm ? parseInt(mm[1], 10) - 1 : -1;
      })
      .filter((i) => items[i]);
    const idxs = [];
    for (const i of rawIdxs) {
      if (!used.has(i)) {
        used.add(i);
        idxs.push(i);
        continue;
      }
      // 该来源已被前面角色占用，找一个还没用的
      let replaced = false;
      for (let k = 0; k < items.length; k++) {
        if (!used.has(k)) {
          used.add(k);
          idxs.push(k);
          replaced = true;
          break;
        }
      }
      // 全部用光也不再重复，宁可少一篇
    }
    // 如果该角色一篇都没分到，从 pool 里补一篇未使用的
    if (!idxs.length && items.length) {
      for (let k = 0; k < items.length; k++) {
        if (!used.has(k)) {
          used.add(k);
          idxs.push(k);
          break;
        }
      }
    }
    // 同一角色内也可能因 LLM 写重复编号导致重复，按归一化标题去重
    const deduped = [];
    const seen = new Set();
    for (const i of idxs) {
      const it = items[i];
      const key = normTitle(it.title) || (it.url || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(i);
    }
    const sourceItems = deduped.map((i) => {
      const it = items[i];
      return {
        title: it.title,
        url: it.url,
        summary: it.summary,
        author: it.author,
        voteUp: it.voteUp,
        source: it.source,
        authority: it.authority,
      };
    });
    return { ...r, sourceItems };
  });
}

// matchReason 模板（PRD 9.1「推荐 100% 带匹配理由」）：阶段/目标/行业，有城市/时间压力时纳入
// 11b：从 alchemy 局部 helper 提升到模块级 —— topicMock 源头（DEMO 直达 / catch 分支共用产物）与
// alchemy 的 !raw / <2 roles 分支复用同款模板；城市/时间以 includes 守卫防重复追加
const matchReasonFor = (p) => {
  const goalTxt = (p.goalNames && p.goalNames.length) ? p.goalNames.join('、') : '';
  let reason = `匹配你的处境：阶段「${p.identityName}」${goalTxt ? ' · 目标「' + goalTxt + '」' : ''}${p.industryName ? ' · 行业「' + p.industryName + '·' + p.subName + '」' : ''}`;
  if (p.city && !reason.includes('城市')) reason += ` · 城市「${p.city}」`;
  if (p.timePressure && !reason.includes('时间')) reason += ` · 时间窗口「${p.timePressure}」`;
  return reason;
};

// ---------- Mock 数据（无 Secret 时兜底，保证"打开即完整"） ----------
const MOCK = {
  search(q) {
    return [
      { title: `${q}——从 0 到 1 的实战路径`, summary: '核心是先建立框架再补细节，避免一上来陷入信息过载。很多新人败在只看不练。', url: 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(q), voteUp: 3120, comment: 188, authority: '3', author: '知乎优秀答主', type: 'Answer' },
      { title: `${q}常见的 5 个误区`, summary: '误区一：盲目搜集资料；误区二：忽视反馈；误区三：用战术勤奋掩盖战略懒惰。', url: 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(q), voteUp: 2014, comment: 96, authority: '2', author: '行业观察', type: 'Article' },
      { title: `面试官最看重的${q}能力`, summary: '不是背概念，而是能否把复杂问题拆成可执行步骤，并讲清取舍。', url: 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(q), voteUp: 1588, comment: 73, authority: '3', author: '资深从业者', type: 'Answer' },
    ];
  },
  hot() {
    return [
      { title: '如何看待年轻人"反向考研"现象？', url: 'https://www.zhihu.com/', summary: '就业预期与个人规划之间的再平衡。', thumbnail: '' },
      { title: 'AI 编程会让初级程序员失业吗？', url: 'https://www.zhihu.com/', summary: '取代的是重复劳动，放大的是系统思维。', thumbnail: '' },
      { title: '毕业三年，如何完成职场第一跳？', url: 'https://www.zhihu.com/', summary: '关键在可迁移能力与靠谱口碑的积累。', thumbnail: '' },
    ];
  },
  zhida(p) {
    return '（未配置 OPENAI_API_KEY，当前为演示模式。配置后将由知乎直答基于真实内容生成。）';
  },
  alchemy(topic, persona = { identityName: '准入行', industryName: 'AI', subName: 'AIGC' }) {
    return topicMock(topic, persona);
  },
};

// 把 topicMock 里的占位来源替换成真实搜索到的 items（LIVE fallback 用）
function replaceMockSources(fb, items) {
  if (!items || !items.length) return { sources: fb.sources };
  const roles = (fb.conflict?.roles || []).map((r, idx) => {
    const pair = items.slice((idx * 2) % items.length, ((idx * 2) % items.length) + 2);
    if (!pair.length) return r;
    return {
      ...r,
      sourceItems: pair.map((it) => ({
        title: it.title,
        url: it.url,
        summary: it.summary,
        author: it.author,
        voteUp: it.voteUp,
        source: it.source,
        authority: it.authority,
      })),
      sources: pair.map((_, i) => `来源${(idx * 2) % items.length + i + 1}`),
    };
  });
  return {
    conflict: { ...(fb.conflict || {}), roles },
    sources: items.slice(0, 6),
  };
}

// 话题自适应演示：评委输入任意话题都能生成连贯、不穿帮的多角色对照（无需 Secret）
// 基于 persona 生成该领域真实三派冲突（mock 场景）
function topicMock(topic, persona = { identityName: '准入行', industryName: 'AI', subName: 'AIGC' }) {
  const ind = persona.industryName || 'AI';
  const sub = persona.subName || persona.sub || 'AIGC';
  const idName = persona.identityName || (persona.identity === 'deepen' ? '在职深耕' : persona.identity === 'shift' ? '在职转型' : '准入行');
  // 真正用到用户处境：目标 / 城市 / 时间压力 / 最困惑 / 简历背景（之前只用了行业派系名，导致"换主题词"观感）
  const goals = persona.goalNames || [];
  const goalTxt = goals.join('、');
  const city = persona.city || '';
  const timeP = persona.timePressure || '';
  const confusion = persona.confusion || topic;
  const edu = persona.education || '';
  // 每个行业的三派（真实存在的冲突立场），mock 兜底用
  const FACTIONS = {
    ai: ['刘看山·算法派', '刘看山·产品派', '刘看山·商业化派'],
    live: ['刘看山·运营派', '刘看山·内容派', '刘看山·投流派'],
    finance: ['刘看山·研究派', '刘看山·交易派', '刘看山·客户派'],
    media: ['刘看山·内容派', '刘看山·渠道派', '刘看山·品牌派'],
    it: ['刘看山·工程派', '刘看山·架构派', '刘看山·业务派'],
    hr: ['刘看山·招聘派', '刘看山·组织派', '刘看山·员工派'],
    sport: ['刘看山·训练派', '刘看山·赛事派', '刘看山·康复派'],
    logistics: ['刘看山·供应链派', '刘看山·仓配派', '刘看山·运力派'],
  };
  const fk = FACTIONS[(ind || '').toLowerCase()] || ['刘看山·技术派', '刘看山·业务派', '刘看山·资源派'];
  const formOf = (n) => n.replace('刘看山·', '') + '形态';
  const mkSrc = (s, vote) => ({
    title: `知乎高赞讨论：「${sub}」· ${s}`,
    url: 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(topic + ' ' + s),
    summary: `在知乎搜索「${topic} ${s}」查看相关高赞回答与文章（演示模式，配置 Secret 后展示真实文章）。`,
    author: '知乎社区',
    voteUp: vote || null,
  });
  // PRD 9.1（11b）：mock 源头即带 matchReason，DEMO 直达 / catch / !raw 三条路径共用产物，一次补齐。
  // stageName 优先（对齐 alchemy 里 pt.identityName = stageName || ... 的归一化），城市/时间由 helper 守卫防重
  const matchReason = matchReasonFor({
    ...persona,
    identityName: persona.stageName || idName,
    industryName: ind,
    subName: sub,
  });
  const mk = (id, name, stance, arg, bestFor, boundary, s1, s2, reb) => ({
    id, name, form: formOf(name), avatar: '🐻‍❄️',
    persona: `${idName}的${name.replace('刘看山·', '')}：信奉在${ind}·${sub}里靠真功夫说话`,
    stance, coreArg: arg, bestFor, boundary,
    matchReason,
    sources: ['来源1', '来源2'],
    sourceItems: [mkSrc(s1, 3120), mkSrc(s2, 1800)],
    rebuts: reb,
  });
  const roles = [
    mk('r1', fk[0],
      `在${sub}里先做出一个真实的小成果`,
      `想搞懂"${topic}"，对${idName}来说最有效的是先在${sub}里动手做一个真实的小尝试。你会在做的过程中撞到真问题，这些问题比任何高赞回答都更能帮你形成自己的判断。`,
      `${idName}、缺真实项目经历的人。`,
      '前提是这个尝试真问题驱动、有取舍思考，不能是跟风凑数。',
      '从0到1实战路径', '新手如何落地第一个项目',
      [{ to: 'r2', text: `光有框架没用，你不去真做"${topic}"，永远停在纸面，一上手就露怯。` }]),
    mk('r2', fk[1],
      `先搭一个判断"${topic}"的行业框架`,
      `别急着冲进去。"${topic}"在${ind}·${sub}里水很深，先搭一个判断框架（目标—路径—风险）再行动，才不会被人带节奏。很多人不是不努力，是连"什么算做好"都没想清楚就盲动。`,
      `已有经历但表达混乱、容易被追问带偏的人。`,
      '前提是别只会背模型，要能现场把陌生问题拆出结构。',
      '最被低估的结构化能力', '如何把复杂问题拆清楚',
      [{ to: 'r1', text: `你闷头做"${topic}"却讲不清为什么，在懂行的人眼里就是瞎折腾。` },
       { to: 'r3', text: '方向当然重要，但光看方向不落地，你永远只是个"评论家"。' }]),
    mk('r3', fk[2],
      `先搞清"${topic}"在${sub}里的方向和真实反馈`,
      `你们都在聊"怎么干${topic}"，却忽略了最现实的：动手前先搞清方向对不对、有没有人能给你真实反馈。选错方向、闭门造车，努力全打水漂。`,
      `信息敏感、时间紧的人。`,
      '前提是别只经营关系不练内功，方向只是进场券。',
      '常见的认知误区', '选错方向比不努力更可怕',
      [{ to: 'r1', text: `你闷头做三个月"${topic}"，结果方向根本不看重这个，时间才是新手最贵的成本。` }]),
  ];
  return {
    ok: true, mock: true,
    topic: `${topic}（${idName} · ${ind} · ${sub}）`,
    conflict: {
      summary: `在「${ind}·${sub}」领域，关于"${topic}"，同一个刘看山却分裂成 ${fk.length} 种样子在吵架——每个派单独听都对，合起来却打架。${idName}最懵的，恰恰是"该信哪派"。`,
      roles,
    },
    framework: {
      title: `信谁框架：在「${ind}·${sub}」里什么情况下该信哪一派`,
      dimensions: [
        { dim: `你缺的是"项目素材"还是"表达"？`, guide: `毫无经历 → 偏${fk[0]}先动手；有经历但讲不利索 → 偏${fk[1]}先练结构化表达。${goalTxt ? `你目标含「${goalTxt}」，表达关迟早要过。` : ''}` },
        { dim: `这件事在${sub}里是"功能型"还是"方向型"？`, guide: `偏落地执行 → 看${fk[0]}开的弹药；偏选择判断 → 听${fk[2]}指的方向与真实反馈。${goalTxt ? `目标「${goalTxt}」往往更吃方向判断。` : ''}` },
        { dim: `你的时间窗口有多长？${timeP ? `（你填了：${timeP}）` : ''}`, guide: `不足一个月 → 先打磨已有认知；三个月以上 → 值得做一个完整小尝试，同时别忘同步搞信息差。${city ? `地点在${city}，信息差要本地化。` : ''}` },
      ],
    },
    quiz: [
      {
        scenario: `作为${idName}的${sub}从业者` + (city ? `（在${city}）` : '') + `，有人问你："${confusion}，你到底怎么看？" 你第一反应更可能是——`,
        options: [
          { label: `先讲我之前在${sub}里做过的某个真实小尝试`, side: 'r1' },
          { label: `先套一个框架（目标—路径—风险）拆解`, side: 'r2' },
          { label: `先问清楚这件事在${sub}里服务什么目标、该听谁的意见`, side: 'r3' },
        ],
        prompt: '你站哪边？结合你自己的经历与能力写下理由。',
        feedback: `其实三派都对你有用。这题想逼你意识到：你习惯用哪只手，另外两只手是不是得补。`,
        analysis: `${fk[0]}强调真实成果，${fk[1]}强调结构先行，${fk[2]}强调方向校准。没有绝对正确答案，关键看你当下最缺哪块。`,
      },
      {
        scenario: `你已经在${sub}里做了一个关于"${confusion}"的小尝试，但` + (timeP ? `在「${timeP}」的压力下，` : '') + `反馈并不好。这时候你更该——`,
        options: [
          { label: '继续迭代，把坑踩透，用失败换真实体感', side: 'r1' },
          { label: '停下来重新搭框架，看是不是一开始目标就错了', side: 'r2' },
          { label: '找行业内的人确认方向，别自己闭门造车', side: 'r3' },
        ],
        prompt: '你站哪边？',
        feedback: '这题在考：实干派容易"把坚持当成正确"，框架派容易"一受挫就否定全局"。',
        analysis: '如果数据/反馈不好，最该先确认方向是否还值得投。方向对，继续迭代才有意义；方向错，越早掉头成本越低。',
      },
      {
        scenario: `下面哪条质疑最能戳中"${topic}"在${sub}里的常见盲区？`,
        options: [
          { label: `"框架再漂亮，不上手做就永远停在纸面。"`, side: 'r1' },
          { label: `"闷头做三个月，方向错了全白费。"`, side: 'r3' },
          { label: `"只听行家意见，容易变成人云亦云的评论家。"`, side: 'r2' },
        ],
        prompt: '你站哪边？',
        feedback: '三派互有盲区：技术派怕"只干不想"，资源派怕"只问不干"，业务派怕"只看不落地"。',
        analysis: '最狠的质疑通常是戳中"把一种工具当成全部答案"。每条质疑都有对应靶子，选择哪条取决于你认为当前讨论最缺什么。',
      },
    ],
    actions: [
      { task: `围绕"${confusion}"，` + (city ? `在${city}的` : '在') + `${sub}里找一个真实对象，写下它的 3 个痛点并各给一个改进方案。`, why: '同时练框架拆解 + 输出，检验你到底"听得懂"还是"做得出"。', role: 'r1' },
      { task: `找 1 位${sub}在行的人做 15 分钟信息访谈` + (city ? `（优先${city}本地）` : '') + `，只问："你判断${confusion}最看重什么？"`, why: '用真实视角校准"该信哪派"，别只在知乎高赞里打转。', role: 'r2' },
      { task: `用 STAR 法准备 1 个关于"${confusion}"的${sub}小故事` + (edu ? `（结合你的背景：${edu.slice(0, 36)}…）` : '') + `，讲 3 分钟并录下来听一遍。`, why: '把实干家的弹药变成谋略家也能听懂的结构化表达。', role: 'r3' },
    ],
    sources: MOCK.search(topic),
  };
}
