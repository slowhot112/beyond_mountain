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
const FORCE_DEMO = /^(1|true|yes)$/i.test(process.env.DEMO_MODE || '');
const STEPFUN_KEY = FORCE_DEMO ? '' : (process.env.STEPFUN_API_KEY || '');
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
      // 检索词不含中文时（如 AIGC / GPT），切不出中文关键词，此时不过滤，否则全网结果会被全部丢掉
      if (!kws.length) return true;
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
// topic 用于「topic 级缓存」：调用方应把话题连同处境摘要一起传进来（如 `话题#准入行|北京|三个月`），
// 使处境不同的人不会共用同一份回答；同处境再次进入可直接命中，吸收慢响应
export async function zhihuZhida(secret, prompt, model = OPENAI_MODEL, ttl = 600, topic = '', timeoutMs = 40000) {
  if (!hasSecret(secret)) return MOCK.zhida(prompt);
  // 1) 先查 topic 级缓存（含处境维度），命中即返回，避免重复慢请求
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
      // 直答偶发慢响应：默认 40s（实测常 20~35s）；输出很大的请求（如六周路线）可传更大 timeoutMs，超时返回空串交上层重试/兜底
      signal: AbortSignal.timeout(timeoutMs),
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
export async function extractResume(secret, text, { allowStepfun = true } = {}) {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  const prompt = `你是简历信息提取器。请从下面这段简历文本中提取与求职决策有关的非身份字段，只输出 JSON，不要解释。
要求：
1. 尽可能详细，不要合并成一句话；学校、公司、项目、技能尽量分别列出。
2. 如果某个字段实在没有信息，用空字符串或空数组，不要编造。
3. 不提取或复述姓名、手机号、邮箱、证件号、详细住址等直接身份信息。
字段：
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
JSON 示例：{"city":"","education":"","experience":"","projects":[],"skills":[],"skillLevels":{},"industry":"","roles":[],"salary":"","certs":[],"languages":[],"summary":""}
简历文本：
${text.slice(0, 14000)}`;

  // 1) 优先 StepFun（独立于知乎 secret）
  if (allowStepfun && STEPFUN_KEY && STEPFUN_KEY.trim()) {
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
  const maxWebByTotal = Math.floor(total * 0.25); // 知乎为主体：正常情况全网最多占 1/4
  let takeWeb, takeZh;
  if (zhihuItems.length === 0) {
    takeWeb = Math.min(webItems.length, total);
    takeZh = 0;
  } else {
    takeZh = Math.min(zhihuItems.length, total - Math.min(webItems.length, maxWebByTotal));
    takeWeb = Math.min(webItems.length, maxWebByTotal);
    // 知乎结果太少、名额空着时，把剩余名额让给全网补满，保证模型有足够语料
    // （旧逻辑在这里会把全网砍到 0，导致冷门话题语料只剩 1 条）
    const rest = total - takeZh - takeWeb;
    if (rest > 0) takeWeb = Math.min(webItems.length, takeWeb + rest);
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
  // 决策B：接入历史炼金包，只带与本次问题相关的记录。
  // 处境摘要：用于直答缓存维度——处境不同就是不同的问题，不能让不同城市/时间压力的人共用一份结果
  const personaDigest = [pt.identityName, (pt.goalNames || []).join(','), pt.city, pt.timePressure].filter(Boolean).join('|');
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
  const ALCHEMY_BUDGET = 85000; // 直答阶段最长占用（ms）；单次直答超时放宽到 70s（云端服务器到知乎是跨洋链路，常需 40~70s 才回），总预算 85s 预留一次快速重试
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() - startedAt > ALCHEMY_BUDGET) {
      console.warn('[alchemy] zhida budget exceeded, skip remaining attempts -> fallback');
      break;
    }
    const aug = attempt === 0
      ? prompt
      : prompt + '\n\n（务必只返回合法 JSON，且 conflict.roles 至少 2 个，每个含 id/name/coreArg/sources/matchReason；不要任何额外文字。）';
    // 缓存 key 必须带处境：否则同一个问题、不同城市/时间压力的人会拿到别人处境下的回答
    const r = await zhihuZhida(secret, aug, OPENAI_MODEL, 600, `${topic}#${personaDigest}`, 70000);
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

  // 模型偶尔只返回一半（长输出被截断很常见）：quiz / actions 缺失时用真实素材补齐，
  // 否则第③步自测页会整片空白、第④步入口被锁，整条流程就断在这儿了。
  if (!Array.isArray(json.quiz) || json.quiz.length < 3) {
    json.quiz = quizFromItems(roles, topic);
  }
  if (!Array.isArray(json.actions) || !json.actions.length) {
    json.actions = fallbackActions(topic, pt, roles.length, null);
  }
  // 行动地图统一成八字段结构（兼容旧 task/why/action），保证前端新 UI 渲染
  json.actions = normalizeActions(json.actions, roles, pt, topic);

  // 来源清单：站内 + 全网混合；站内不足时用全网补满 6 条，让"来源区"始终体现全网已接入
  const zhPart = zhihuItems.slice(0, 4);
  const webPart = webItems.slice(0, Math.max(2, 6 - zhPart.length));

  return {
    ok: true, mock: false,
    ...json,
    conflict: { ...(json.conflict || {}), roles },
    usedHistory: selected.map((s) => s.rec.topic), // 本次参考了哪些历史（前端展示用）
    // 正常路径也要给检索统筹，让"知乎多少条 / 全网多少条"在成功时同样看得见
    searchStats: makeSearchStats({
      queries: qs.length,
      zhihuFound: zhihuItems.length,
      webFound: webItems.length,
      zhihuChosen: picked.zhihuChosen,
      webChosen: picked.webChosen,
      totalChosen: picked.corpus.length,
      mode: 'normal',
    }),
    sources: [...zhPart, ...webPart].slice(0, 6),
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
      ? (isQuestion ? summaryBrief : summaryBrief)
      : titleBrief;
    const isWeb = mainIt.source === 'web';
    // name：优先用真实作者；名字太脏（知乎答主/全网来源/域名等）时回退到一组有区分度的派系标签，避免所有角色都叫"知乎答主"导致自测题选项雷同
    const authorName = cleanAuthor(mainIt.author, isWeb, mainIt.url);
    const niceAuthor = (authorName && !/(知乎答主|全网来源|全网|答主|来源)/.test(authorName) && authorName.length <= 12) ? authorName : '';
    const PERSONA_LABELS = ['一线从业者', '资深从业者', '行业观察者', '过来人', '招聘方', '转行亲历者'];
    const name = niceAuthor || PERSONA_LABELS[i % PERSONA_LABELS.length];
    const formTag = isWeb ? '全网资料' : '知乎内容';
    // 边界：点出该观点的局部前提，比"个人观点"具体
    const boundary = summaryBrief
      ? `该观点来自${formTag}「${authorName}」的局部经验，主要反映 ta 的城市、资历、客户群体；换个人结果可能不一样。`
      : '该观点来自单一来源，需结合你自己的城市、资历和处境判断。';
    out.push({
      id,
      // 角色名是观点身份，不直接把真实作者名变成用户要站队的对象。
      name: PERSONA_LABELS[i % PERSONA_LABELS.length],
      form: formTag,
      side: '',
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
      // 字段名必须与模型输出 / 前端一致：{to, text}（旧写法 {target, quote} 会让交锋区显示空白）
      r.rebuts = [{
        to: next.id,
        text: `但 ${next.name || next.id} 提醒：${nextStance}。这说明「${r.name || r.id}」的判断未必适用于所有人。`,
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

// 步骤"去模板化"：把 ①学（周一）：xxx 这种统一标签洗掉，改成"1.（周一）xxx"，
// 只保留时间锚点与动作本身，避免每周的步骤都长一个模样。仅对带 ①~⑥ 的文本生效，可重复调用。
function humanizeSteps(s) {
  const str = String(s || '');
  if (!/[①②③④⑤⑥]/.test(str)) return s;
  const parts = str.split(/[；;]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return str;
  return parts.map((x, i) => {
    const m = x.match(/^([①②③④⑤⑥])\s*[学拆练做补验]?\s*（([^）]*)）\s*[:：]?\s*(.*)$/);
    if (m) return `${i + 1}.${m[2] ? `（${m[2]}）` : ''}${m[3] || ''}`;
    return `${i + 1}. ${x.replace(/^[①②③④⑤⑥]\s*[学拆练做补验]?\s*/, '')}`;
  }).join('；');
}

// 根据处境卡的时间压力，给兜底行动地图生成「决策验证路线」：
// 每条 = when + 关键假设 + 去哪儿（平台+关键词）+ 怎么做（分步）+ 完成标准 + 坚持信号 + 止损信号 + role
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
  const cityIn = city ? `在${city}` : '';
  const citySuffix = city ? `${city}本地` : '';

  // 时间压力分桶：紧急(<1周) / 短期(月内) / 长期(>3个月或没填)——与路线总时长用同一套判定，避免两处不一致
  const bucket = routeBucket(tp);

  const mk = (when, hypothesis, where, steps, done, go, stop, role) => ({ when, hypothesis, where, steps, done, goSignal: go, stopSignal: stop, role });
  let core = [];
  if (bucket === 'urgent') {
    core = [
      mk('第1周 · 岗位与差距',
        `"${dir}"这个方向现在真的在招人，而且我的背景够得着——不是我想当然`,
        `BOSS直聘 / 实习僧 / 拉勾 / 脉脉（搜"${dir}"${city ? '，地点选' + city : ''}）`,
        `①学（半天）：读 2 份这个岗位的行业/岗位介绍，写 1 页概念卡；②拆（第1天）：拆 3 条真实 JD，填成"要求/工具/场景/门槛"四列表；③练（第2天）：再收 7 条凑满 10 条，统计出现最多的 5 个硬性要求；④做（第3天）：把 10 条 JD 的硬性要求和你的背景逐项对照，标"已满足/部分满足/不满足"；⑤补（第4天）：专门找 3 条"门槛极高/要求模糊"的 JD 单独标注，作为反例，别只看够得着的；⑥验（第5天）：把对照表发给 1 位从业者或学长，请他指出"你觉得我差得最多的是哪一项"。`,
        `《岗位地图》1 份：≥10 条去重 JD（含公司/岗位/城市/要求/发布日期）+ 四列分类表 + 词频前五 +《个人能力差距清单》（目标要求/现有证据/差距/补强动作），另附 3 条反例 JD。`,
        `若 10 条里有 6 条以上的硬性要求你能对上，且从业者说"这个背景可以试试"，说明方向够得着，直接进下一步。`,
        `若 10 条里超过 7 条都卡在同一个你短期补不上的硬门槛（学历/证书/年限/专业），说明这个方向现在进不去，立刻换相邻方向，别硬撞。`,
        roleFor(0)),
      mk('第1~2周 · 一手事实',
        `过来人的真话比我自己查 10 篇文章更接近真相`,
        `脉脉 / 知乎 / 小红书 / 校友群 / 微信${city ? '（定位' + city + '）' : ''}（找正在做"${dir}"的人）`,
        `①学（半天）：准备 6~8 个开放问题（上次做这事花了多久、哪一步返工、最后怎么交付），先找 1 人试访；②拆（第1天）：同时私信/发帖约 3 位从业者；③练（第2~3天）：完成第 1 次 30 分钟对话，记录原话；④做（第4~5天）：完成第 2、3 次对话，共 3 次；⑤补（第6天）：专门问"你见过转行失败的人卡在哪"，收集反例；⑥验（周末）：整理成"用户原话/我观察到的事实/我的解释"三栏，标出哪条推翻了我原来的想法。`,
        `《调研纪要》1 份：3 次访谈（每次 ≥30 分钟），每次分开记"用户原话 / 观察事实 / 我的解释"三栏 + 至少 1 条推翻我原判断的记录 + 1 个可以做成作品的真实痛点。`,
        `若 3 人里有 2 人给出具体、可复制、互相不矛盾的动作，且至少 1 人说"你这种背景有机会"，说明这条路真实存在。`,
        `若 3 人里多数说"现在基本不招转行"，或建议互相矛盾到无法落地，说明信息还不足，先别辞/别梭哈，按他们的说法再验证一轮。`,
        roleFor(1)),
      mk('第2~3周 · 最小产出与投递',
        `我能在 2 周内交出一样"求职拿得出手"的东西，并用真实投递检验它`,
        `飞书/Notion/语雀（写方案）+ BOSS直聘/实习僧/公司官网（投递）${city ? '，优先' + city : ''}`,
        `①学（半天）：看 2 份这个岗位的真实作品/案例，明确"什么算合格"；②拆（第1天）：把上面访谈得到的真实痛点，拆成"输入→处理→产出"的最小方案；③练（第2天）：做 1 个小练习建立基线（比如先手写一版，记录耗时和哪里卡壳）；④做（第3~5天）：做出 1 份能给人看的最小产出（1 页方案 / 1 个小 Demo / 1 份分析报告，任选其一，能用就行）；⑤补（第6天）：补 3 条 刁钻情况（信息缺失、极端情况、它答不了的情况）并写明怎么兜底；⑥验（周末）：把产出写进 1 页简历（数字都有原始记录），投出 5 份并记入投递漏斗表（投递/回复/面试）。`,
        `最小产出 1 份（可给别人看的链接或 PDF）+ 3 条 刁钻情况 与兜底说明 + 1 页可解析简历 + 投递漏斗表（已真实投出 ≥5 份，记录回复数与面试数）。`,
        `若 5 份投递里有 1 份以上回复，或有人愿意聊你的作品，说明这条路跑得通，加大投入。`,
        `若投出 5~10 份零回复，且没人说得出"你差在哪"，说明岗位选得太宽或简历没打中 JD 关键词，先收窄到一个主赛道再投，而不是继续海投。`,
        roleFor(2)),
    ];
  } else if (bucket === 'short') {
    core = [
      mk('第1周 · 岗位与行业认知',
        `我能说清"${dir}"到底要什么样的人，而不是凭感觉在转`,
        `BOSS直聘 / 实习僧 / 拉勾 / LinkedIn / 公司官网（搜"${dir}"${city ? '，地点选' + city : ''}）`,
        `①学（周一）：读 2 份这个岗位的行业资料/白皮书，写 1 页概念卡；②拆（周二）：拆 3 条真实 JD，填"要求/工具/场景/门槛"四列表；③练（周三）：再收 7 条凑满 10 条，统计词频，建立第一版基线；④做（周四）：扩到 ≥30 条去重 JD 并完成四列分类，写出《岗位地图》；⑤补（周五）：专门挑 5 条门槛异常高或要求互相矛盾的 JD 作为反例，标出"哪些是我现在进不去的"；⑥验（周末）：对照 JD 写出《个人能力差距清单》，找 1 位从业者看一遍并请他指出"你觉得我差得最多的是哪项"。`,
        `《岗位地图》1 份：≥30 条去重 JD + 四列分类表 + 词频前十 +《个人能力差距清单》（目标要求/现有证据/差距/补强动作/完成日期），另附 5 条反例 JD。`,
        `若 30 条里有一半以上的硬性要求你能对上，或从业者说"这个背景可以试试"，说明方向选对了，继续往下做。`,
        `若 30 条里超过 20 条都卡在同一个短期补不上的硬门槛（学历/证书/年限/专业），说明这个方向现在进不去，回到岗位地图换相邻方向，别硬撞 6 周。`,
        roleFor(0)),
      mk('第2周 · 一手调研与基本功',
        `真实用户/从业者的原话，比我自己想象的需求更能决定我该做什么作品`,
        `脉脉 / 知乎 / 小红书 / 校友群${city ? '（定位' + city + '）' : ''}（找真实用户与从业者，每人 30 分钟）`,
        `①学（周一）：补这个岗位的核心基本功（选 1 门课或 1 本书的入门章节），写 1 页概念卡；②拆（周二）：拆 3 个同类真实产品/案例，用同一组 10 个任务去比，别只比首页功能；③练（周三）：先找 1 人试访，修掉诱导性和带答案的问题；④做（周四~周五）：完成 3 次 30 分钟访谈，追问"上次做这件事发生了什么、花了多久、哪一步返工、最后怎么交付"；⑤补（周五）：整理时严格分开"用户原话""我观察到的事实""我的解释"，防止自己脑补；⑥验（周末）：产出《调研/竞品报告》，选 1 个出现 ≥2 次或后果最明显的痛点作为后面作品的选题。`,
        `《调研报告》1 份：3 次访谈纪要（每次分"用户原话/观察事实/我的解释"三栏）+ 1 张流程图 + 3 个同类产品用 10 个统一任务的对比表 + 1 个明确选定的作品选题。`,
        `若 3 次访谈里有 ≥2 次指向同一个痛点，且从业者说"这个点抓得准"，说明选题站得住，可以开工做作品。`,
        `若 3 次访谈痛点完全发散、互相打不通，或从业者说"这不是真问题"，说明你还没找到真需求，先补调研再动手，别急着做作品。`,
        roleFor(1)),
      mk('第3周 · 评测与对比',
        `我能用同一批样本说清"哪个方案/工具/做法更靠谱"，而不是凭感觉选`,
        `这个岗位真实在用的 ≥3 个工具/平台/方案 + 飞书表格或 Excel（记录评分）`,
        `①学（周一）：搞清这个岗位的 3~5 个关键评价指标（如准确率/耗时/成本/稳定性），写 1 页指标说明；②拆（周二）：拆 1 份别人的评测或对比案例，学它的评分口径；③练（周三）：建立 ≥20 条固定测试样本（10 条正常 + 5 条边界 + 5 条 刁钻情况），先跑 1 个方案建立基线；④做（周四）：用同一批样本跑完 ≥3 个方案，逐项按 0~2 分打分并记录成本与耗时；⑤补（周五）：把失败样本按原因归类（数据不足/指令不清/格式失败/幻觉/流程问题），请第 2 个人复评 ≥5 条；⑥验（周末）：产出《评测/对比报告》，写下选了哪个、为什么、以及它会在什么情况下失效。`,
        `《评测报告》1 份：≥20 条固定测试样本（10 正常 + 5 边界 + 5 刁钻情况）+ ≥3 个方案用同一批输入的逐项评分表（0~2 分）+ 刁钻情况 归因分类 + 成本与耗时记录 + 明确的选型结论与失效边界。`,
        `若某个方案在多数样本上明显领先、且你能说清它为什么赢，说明你已具备这个岗位的核心判断力，把它写进作品。`,
        `若 3 个方案得分接近、看不出差别，或你的评分标准自己都说不清，说明样本设计有问题（太简单/没区分度），重做样本而不是硬下结论。`,
        roleFor(2)),
      mk('第4~5周 · 做出可演示的作品',
        `我能在 2 周内做出一个别人能打开、能走通、能评价的作品`,
        `这个岗位真实在用的工具（如原型/搭建/开发/分析平台，选你能上手的）+ 公开托管（生成可访问链接）`,
        `①学（周一）：确定作品范围，写 1 页 一页作品说明（一句话问题/目标用户/核心任务/输入/输出/成功指标/明确不做的）；②拆（周二）：画出用户流程与数据流程，列出正常、空白、加载、失败、超时等状态；③练（周三）：先用模拟数据把核心流程跑通，建立第一版基线；④做（周四~周五）：接上真实能力（模型/数据/外部服务），做出能用的版本，记录优化前/后；⑤补（第2周前半）：补边界与反例（空输入、超长输入、它答不了的情况），修掉影响核心流程的问题；⑥验（第2周周末）：部署成可公开访问的链接，找 3 名没参与的人试用，记录完成率、用时、卡点和原话。`,
        `作品 1 个：可公开访问的链接 + 1 页 作品说明（含流程图）+ 优化前后对比 + 3 名真人试用记录（完成率/用时/卡点/原话）+ 至少 1 处根据反馈做的修改。`,
        `若 3 名试用者里 ≥2 人能在 5 分钟内、没有你口头指导的情况下走通核心流程，说明作品达到可展示水平，可以写进简历。`,
        `若 3 人里多数卡在同一个步骤、或需要你在旁边解释才能走通，说明核心流程还没打通，先修这一个卡点，别急着加新功能。`,
        roleFor(3)),
      mk('第6周 · 求职冲刺',
        `我能在 1 周内把六周的东西变成能投出去、能讲清楚的东西`,
        `飞书/Word（简历）+ BOSS直聘/实习僧/公司官网/内推（投递）+ 手机录音（模拟面试）`,
        `①学（周一）：用 STAR 结构（情境/任务/动作/结果）重写简历，只写已发生、可回查的事实；②拆（周二）：拆 5 条目标 JD 的关键词，把简历与项目描述对齐；③练（周三）：准备 ≥30 道面试题的提纲（每道 3~5 行），先自己录音答 5 道；④做（周四）：完成第 1 次 30 分钟模拟面试，删掉空话和没有出处的数字；⑤补（周五）：做第 2、3 次模拟面试（45 分钟，追问细节与 刁钻情况），把答不上来的题补进题库；⑥验（周末）：投出 ≥10 份，建立投递漏斗表（投递数/回复数/面试数），并按漏斗结果写下"下周先改哪一项"。`,
        `求职包 1 套：1 页可被解析的 PDF 简历（每个数字都有原始记录）+ ≥30 道面试题提纲 + 3 次录音模拟面试记录 + 投递漏斗表（已投 ≥10 份，记录回复数与面试数）+ 1 条根据漏斗结果确定的下周调整项。`,
        `若投出 10 份后拿到 ≥1 次面试邀约，或有人主动来聊，说明你的材料已经进入真实通道，继续按漏斗迭代。`,
        `若投出 20~30 份仍几乎零回复，按漏斗表回头查：岗位是否太宽、简历关键词是否没打中 JD、项目与 JD 是否不相关——收窄到一个主赛道重投，而不是继续海投。`,
        roleFor(4)),
    ];
  } else {
    core = [
      mk('第1~2周 · 岗位与行业认知',
        `我能说清"${dir}"到底要什么样的人，而不是凭感觉在转`,
        `BOSS直聘 / 实习僧 / 拉勾 / LinkedIn / 公司官网（搜"${dir}"${city ? '，地点选' + city : ''}）+ 行业白皮书/报告`,
        `①学（第1周前半）：读 2 份行业资料或白皮书，写 1 页概念卡，画出这个岗位所在的产业链；②拆（第1周中段）：拆 5 条真实 JD，填"要求/工具/场景/门槛"四列表；③练（第1周后半）：收集到 20 条 JD，统计词频，建立第一版基线；④做（第2周前半）：扩到 ≥50 条去重 JD（有余力到 100 条）并完成四列分类；⑤补（第2周中段）：挑 10 条门槛异常高或要求互相矛盾的 JD 作为反例，标出"哪些我现在进不去"；⑥验（第2周周末）：写《个人能力差距清单》，找 1 位从业者看一遍，请他指出"你觉得我差得最多的是哪项"。`,
        `《岗位地图》1 份：≥50 条去重 JD + 四列分类表 + 词频前十 +《个人能力差距清单》（目标要求/现有证据/差距/补强动作/完成日期）+ 10 条反例 JD + 3 分钟口述录音（讲清目标岗位服务什么场景、需要什么能力、我已有何证据）。`,
        `若一半以上 JD 的硬性要求你能对上，或从业者说"这个背景可以试试"，说明方向选对了，继续往下走。`,
        `若 50 条里超过 30 条都卡在同一个短期补不上的硬门槛（学历/证书/年限/专业），说明这个方向现在进不去，回到岗位地图换相邻方向，别在错方向上耗 3 个月。`,
        roleFor(0)),
      mk('第3~4周 · 补核心基本功',
        `系统补齐这个岗位的核心基本功，比零散看文章更能缩短周期`,
        `1 门入门课或 1 本被多次提及的书（选这个岗位公认的）+ 飞书/Notion（笔记）+ 公开平台（可选输出）`,
        `①学（第3周前半）：按能力差距清单选 1 门具体课程或书，只学缺口最大的 2~3 个模块；②拆（第3周中段）：拆 1 个真实案例，用课里的概念解释它为什么这么做；③练（第3周后半）：做 1 个小练习，产出第一个可比较的样例或分数；④做（第4周前半）：完成核心章节，输出 1 份学习笔记（可公开，也可只给 1 位从业者看）；⑤补（第4周中段）：专门整理 5 个"我原来理解错了"的概念作为反例；⑥验（第4周周末）：用新学的术语重新描述自己的 1 段过往经历，发给 1 位从业者确认"这么说对不对"。`,
        `学习笔记 1 份（课程/书名 + 核心收获 + 5 个"我原来理解错了"的概念）+ 用新术语重写的 1 段个人经历 + 从业者的一句确认或修正。`,
        `若学完能用新术语讲清自己的经历，且从业者说"理解没跑偏"，说明基本功接上了，可以进调研。`,
        `若学完仍觉得"每个概念都懂但串不起来"，或被指出理解有偏差，说明课程太浅/方向不对，换更偏实战的资源，别继续往下堆课时。`,
        roleFor(1)),
      mk('第5~6周 · 一手调研与竞品拆解',
        `真实用户和从业者的原话，比我的想象更能决定我该做什么`,
        `脉脉 / 知乎 / 小红书 / 校友群${city ? '（定位' + city + '）' : ''}（真实用户与从业者）+ 同类真实产品/案例`,
        `①学（第5周前半）：读 1 份用户访谈方法论，准备 6~8 个开放问题，先找 1 人试访；②拆（第5周中段）：选 3 个同类真实产品/案例，用同一组 10 个任务去比，不只比首页；③练（第5周后半）：完成第 1 次 30 分钟访谈，记录原话；④做（第6周前半）：再完成 2 次访谈（共 3 次，有余力到 5 次），画出流程图；⑤补（第6周中段）：整理时严格分开"用户原话""我观察到的事实""我的解释"，并专门记 1 条推翻我原判断的证据；⑥验（第6周周末）：产出《调研/竞品报告》，选定 1 个出现 ≥2 次或后果最明显的痛点作为作品选题。`,
        `《调研报告》1 份：≥3 次访谈纪要（每次分"用户原话/观察事实/我的解释"三栏）+ 1 张流程图 + 3 个同类产品用 10 个统一任务的对比表 + 至少 1 条推翻我原判断的记录 + 1 个明确选定的作品选题。`,
        `若 ≥2 次访谈指向同一个痛点，且从业者说"这个点抓得准"，说明选题站得住，可以开工做作品。`,
        `若访谈痛点完全发散、互相打不通，或从业者说"这不是真问题"，说明你还没找到真需求，先补调研，别急着动手做。`,
        roleFor(2)),
      mk('第7~8周 · 评测与对比',
        `我能用同一批样本说清"哪个方案/工具/做法更靠谱"，而不是凭感觉选`,
        `这个岗位真实在用的 ≥3 个工具/平台/方案 + 飞书表格或 Excel（记录评分）`,
        `①学（第7周前半）：搞清这个岗位的 3~5 个关键评价指标（如准确率/耗时/成本/稳定性），写 1 页指标说明；②拆（第7周中段）：拆 1 份别人的评测或对比案例，学它的评分口径；③练（第7周后半）：建立 ≥20 条固定测试样本（10 条正常 + 5 条边界 + 5 条 刁钻情况），先跑 1 个方案建立基线；④做（第8周前半）：用同一批样本跑完 ≥3 个方案，逐项 0~2 分打分，记录成本与耗时；⑤补（第8周中段）：按原因归类失败样本（数据不足/指令不清/格式失败/幻觉/流程问题），请第 2 人复评 ≥5 条并讨论分歧；⑥验（第8周周末）：产出《评测/对比报告》，写明选了哪个、为什么、以及它会在什么情况下失效。`,
        `《评测报告》1 份：≥20 条固定测试样本（10 正常 + 5 边界 + 5 刁钻情况）+ ≥3 个方案用同一批输入的逐项评分表（0~2 分）+ 刁钻情况 归因分类 + 成本与耗时记录 + 第 2 人复评记录 + 明确的选型结论与失效边界。`,
        `若某个方案在多数样本上明显领先、且你能说清它为什么赢，说明你已具备这个岗位的核心判断力，把它写进作品。`,
        `若 3 个方案得分接近、看不出差别，或评分标准自己都说不清，说明样本设计没区分度，重做样本而不是硬下结论。`,
        roleFor(3)),
      mk('第9~10周 · 做出可演示的作品',
        `我能做出一个别人能打开、能走通、能评价的作品，而不只是"了解过"`,
        `这个岗位真实在用的工具（原型/搭建/开发/分析平台，选你能上手的）+ 公开托管（生成可访问链接）`,
        `①学（第9周前半）：写 1 页 一页作品说明（一句话问题/目标用户/核心任务/输入/输出/成功指标/明确不做的范围）；②拆（第9周中段）：画用户流程与数据流程，列出正常、空白、加载、失败、超时等状态；③练（第9周后半）：先用模拟数据把核心流程跑通，建立第一版基线；④做（第10周前半）：接上真实能力（模型/数据/外部服务），做出能用的版本，记录优化前/后；⑤补（第10周中段）：补边界与反例（空输入、超长输入、它答不了的情况），把前面两周的测试样本接进来，修掉影响核心流程的问题；⑥验（第10周周末）：部署成可公开访问的链接，找 3 名没参与的人试用，记录完成率、用时、卡点和原话。`,
        `作品 1 个：可公开访问的链接 + 1 页 作品说明（含流程图）+ 优化前后对比 + 3 名真人试用记录（完成率/用时/卡点/原话）+ 至少 1 处根据反馈做的修改 + 1 份 作品说明（写清问题、用户、流程、怎么测、真实结果、限制）。`,
        `若 3 名试用者里 ≥2 人能在 5 分钟内、没有你口头指导的情况下走通核心流程，说明作品达到可展示水平，可以写进简历。`,
        `若多数人卡在同一个步骤、或需要你在旁边解释才能走通，说明核心流程还没打通，先修这一个卡点，别急着加新功能。`,
        roleFor(4)),
      mk('第11~12周 · 求职冲刺',
        `我能把这两个月的东西，变成能投出去、能讲清楚、经得起追问的东西`,
        `飞书/Word（简历）+ BOSS直聘/实习僧/公司官网/内推（投递）+ 手机录音（模拟面试）`,
        `①学（第11周前半）：用 STAR 结构（情境/任务/动作/结果）重写简历，只写已发生、可回查的事实；②拆（第11周中段）：拆 5 条目标 JD 的关键词，把简历与项目描述对齐；③练（第11周后半）：准备 ≥30 道面试题的提纲（每道 3~5 行），先自己录音答 5 道；④做（第12周前半）：完成第 1 次 30 分钟模拟面试，删掉空话和没有出处的数字；⑤补（第12周中段）：再做 2 次 45 分钟模拟面试（追问模型/做法/取舍/刁钻情况），把答不上来的题补进题库；⑥验（第12周周末）：投出 ≥10 份，建立投递漏斗表（投递数/回复数/面试数），按漏斗结果写下"下一步先改哪一项"。`,
        `求职包 1 套：1 页可被解析的 PDF 简历（每个数字都有原始记录）+ ≥30 道面试题提纲 + 3 次录音模拟面试记录 + 投递漏斗表（已投 ≥10 份，记录回复数与面试数）+ 1 条根据漏斗结果确定的下一步调整项。`,
        `若投出 10 份后拿到 ≥1 次面试邀约，或有人主动来聊，说明你的材料已进入真实通道，继续按漏斗迭代。`,
        `若投出 20~30 份仍几乎零回复，按漏斗表回头查：岗位是否太宽、简历关键词是否没打中 JD、项目与 JD 是否不相关——收窄到一个主赛道重投，而不是继续海投。`,
        roleFor(5)),
    ];
  }

  return core.slice(0, 6).map((a) => ({ ...a, steps: humanizeSteps(a.steps) }));
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
      // 旧六字段的 action 平滑过渡为 steps；顺手把"①学（周一）"这类统一标签洗掉
      steps: humanizeSteps(base.steps || base.action || ''),
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

// ---------- 决策B：历史炼金包接入（实体命中判定） ----------
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
// 选相关历史：当前问题与历史问题共享至少 1 个核心实体词即算相关，最多带 3 条；零命中则不带。
export function selectHistory(topic, records) {
  if (!topic || !Array.isArray(records) || !records.length) return [];
  const cur = historyKeywords(topic);
  if (!cur.size) return [];
  return records
    // 演示快照只用于回看，不得把其中的角色/结论带进下一轮历史上下文，避免演示素材影响真实判断。
    .filter((r) => r && r.topic && r.topic !== topic && !(r.mock || r.mode === 'demo' || (r.data && r.data.mock)))
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
  // 上一轮行动的现实结果（决策C）：让下次炼金知道"哪些已验证过、哪些被打脸"
  const fb = rec.actionFeedback;
  if (fb) {
    const fbBits = [];
    if (fb.done) fbBits.push(`做了${fb.done}步`);
    if ((fb.up || []).length) fbBits.push(`证实${fb.up.length}条`);
    if ((fb.down || []).length) fbBits.push(`打脸${fb.down.length}条`);
    if ((fb.unclear || []).length) fbBits.push(`待定${fb.unclear.length}条`);
    const note = (fb.notes || []).slice(-1)[0];
    if (fbBits.length) parts.push(`行动结果：${fbBits.join('/')}`);
    if (note && note.note) parts.push(`用户反馈：${briefText(note.note, 60)}`);
  }
  return parts.join('：');
}
export function buildHistoryBlock(selected) {
  if (!selected || !selected.length) return '';
  const lines = selected.map((s) => `- ${summarizeHistory(s.rec)}`).join('\n');
  return `
你过去炼过的、与本次问题相关的炼金包（★仅供参考；若与本次问题无关，请完全忽略，绝不要被它带偏结论，也不要套用它的行业默认设定）：
${lines}
请据此：① 不要再重复验证用户早已倾向的那一派，直接推进到下一步验证；② 注意用户上次的盲区视角，这次优先补上；③ 若本次与上次判断有出入，在行动里点出「相比上次，你的判断变了 / 没变」；④ 若历史里带了「行动结果」，已被现实证实的判断不要再让用户重做一遍，被打脸 / 触发收手信号的方向要降优先级或建议换路。
`;
}

// ---------- 行动地图 v2：带终点的完整路线（roadmap） ----------
// 时间压力分桶：紧急(<1周) / 短期(月内) / 长期(>3个月或没填)，决定路线总时长
function routeBucket(tp) {
  const s = String(tp || '').trim();
  // 先看长期信号（三个月以上 / 半年 / 长期），否则"三个月以上"会因含"月"被误判成一个月左右
  if (/半年|一年|长期|不急|慢慢|没有|暂无|三\s*个月|3\s*个月|四\s*个月|4\s*个月|五\s*个月|5\s*个月|六\s*个月|6\s*个月|[3-9]\s*个月以上/.test(s)) return 'long';
  if (/周|天|马上|立即|立刻|急|尽快|24\s*小|今晚|这周|两天/.test(s)) return 'urgent';
  if (/月/.test(s)) return 'short';
  return 'long';
}
export function routeHorizon(bucket) {
  return { urgent: '约 2~3 周', short: '约 6 周', long: '约 8~12 周' }[bucket] || '约 6 周';
}

// 路线语料块：把"本次检索到的真实资料"作为事实锚，任务的事实断言只能从这里引，引不到就标 verify
function routeCorpus(sources) {
  const arr = Array.isArray(sources) ? sources.filter((s) => s && s.title) : [];
  if (!arr.length) return '';
  const lines = arr.map((s, i) => `【来源${i + 1}】${s.title}${s.summary ? '\n' + briefText(s.summary, 140) : ''}`).join('\n\n');
  return `\n本次检索到的真实资料（★关于"行业/岗位要什么、行情、路径通不通"的事实断言，只能从下面引用并逐条标【来源N】；不依赖这些资料的任务——例如它本身就是去拿一手事实——标 "verify"）：
${lines}
`;
}

// 上一轮行动的现实结果 → 本轮路线的调整依据（决策C：行动结果反哺下一次排路线）
// 已证实的不再重复验证；被打脸 / 触发收手信号的降优先级或换路；用户写的现实反馈必须落到任务里
function buildFeedbackBlock(feedback) {
  const list = (Array.isArray(feedback) ? feedback : []).filter((f) => f && (
    f.done || (f.up || []).length || (f.down || []).length || (f.unclear || []).length || (f.notes || []).length
  ));
  if (!list.length) return '';
  const lines = list.slice(0, 3).map((f, i) => {
    const bits = [];
    bits.push(`做了 ${f.done || 0} 步`);
    if ((f.up || []).length) bits.push(`被现实证实 ${f.up.length} 条：${f.up.slice(0, 3).map((t) => '「' + briefText(t, 40) + '」').join('、')}`);
    if ((f.down || []).length) bits.push(`被打脸 ${f.down.length} 条：${f.down.slice(0, 3).map((t) => '「' + briefText(t, 40) + '」').join('、')}`);
    if ((f.unclear || []).length) bits.push(`证据还不足 ${f.unclear.length} 条`);
    const note = (f.notes || []).slice(-3).map((n) => '用户原话：' + briefText(n.note || '', 60)).join('；');
    return `- 第${i + 1}轮${f.topic ? `（主题「${briefText(f.topic, 30)}」）` : '（同一方向）'}：${bits.join('；')}${note ? '。' + note : ''}`;
  }).join('\n');
  return `
【上一轮行动的现实结果（★必须据此调整本轮路线，不能视而不见）】
${lines}
据此必须做到：
① 已被现实证实的判断，本轮【不要再重复验证】，直接推进到下一步（可在该任务的 steps 里写"上一轮已验证：…，本轮直接往前推进"）；
② 被打脸 / 触发收手信号的方向，本轮【降低优先级】：要么换相邻方向，要么换一种做法，并在任务里点明"上一轮走不通，故本轮改为…"；
③ 用户自己写的现实反馈（含数字、卡点、结果）必须体现在相应任务的 steps / done 里，不许忽略。
`;
}

// 把模型输出的任务证据引用解析成可点开的原文；引用不上就降级 verify（宁缺毋假，绝不硬编）
// normalizeActions 只保留八字段，会丢弃 ev，所以这里在归一化后再把原始 ev 解析挂回
function attachEv(tasks, rawTasks, sources) {
  const src = Array.isArray(sources) ? sources : [];
  return (tasks || []).map((t, i) => {
    const rawRaw = (rawTasks && rawTasks[i] && rawTasks[i].ev) || t.ev || [];
    const raw = Array.isArray(rawRaw) ? rawRaw : [rawRaw];
    const refs = [];
    let verify = false;
    raw.forEach((e) => {
      const n = /来源\s*(\d+)/.exec(String(e || ''));
      const it = n ? src[Number(n[1]) - 1] : null;
      if (it && it.title) refs.push({ title: it.title, url: it.url || '' });
      else if (/verify|待验证|待你验证/i.test(String(e))) verify = true;
    });
    return { ...t, ev: refs, evVerify: verify };
  });
}

// roadmap 任务平铺（兼容旧前端/导出；每条带阶段标题方便识别）
export function flattenRoadmap(roadmap) {
  if (!roadmap || !Array.isArray(roadmap.phases)) return [];
  const out = [];
  (roadmap.phases || []).forEach((p) => {
    (p.tasks || []).forEach((t) => {
      out.push({ ...t, when: t.when || p.week || '', _phase: `${p.no || ''} ${p.title || ''}`.trim() });
    });
  });
  return out;
}

// 兜底：把普通 action 列表包装成"带终点"路线结构，保证新 UI 任何情况都能渲染
export function buildFallbackRoadmap(actions, persona, topic) {
  const acts = Array.isArray(actions) ? actions : [];
  const bucket = routeBucket(persona && persona.timePressure);
  const horizon = routeHorizon(bucket);
  const splitAt = bucket === 'urgent' ? 1 : 3;
  const head = acts.slice(0, splitAt);
  const tail = acts.slice(splitAt);
  const wk = bucket === 'urgent' ? ['第1周', '第2~3周'] : bucket === 'short' ? ['第1~3周', '第4~6周'] : ['第1~6周', '第7~12周'];
  const phases = [];
  if (head.length) {
    phases.push({
      no: 1, week: wk[0], title: '摸清方向：这个岗要什么样的人，你还差什么',
      focus: '收集真实 JD 与一手事实，产出岗位地图与能力差距清单，先把方向定下来',
      phaseDone: '岗位地图与能力差距清单已完成，且至少 1 位从业者看过并给了具体意见',
      tasks: head.map((t) => ({ ...t, ev: [], evVerify: true })),
    });
  }
  if (tail.length) {
    phases.push({
      no: 2, week: wk[1], title: '做出实物并投出去',
      focus: '把调研与评测的结论做成作品，再变成简历、题库和真实投递',
      phaseDone: '至少交出 1 个可公开访问的作品 + 1 页可解析简历，并已真实投出 ≥10 份',
      tasks: tail.map((t) => ({ ...t, ev: [], evVerify: true })),
    });
  }
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    horizon,
    goal: {
      text: `${horizon}内，交得出一整套求职拿得出手的材料：岗位地图 + 能力差距清单、调研纪要、评测报告、一个可公开访问的作品、一页可解析的简历，并已真实投出 ≥10 份、按投递漏斗迭代过。`,
      basis: `按你填的时间压力「${persona && persona.timePressure ? persona.timePressure : '未明确'}」与目标而定；所有数字都来自你自己的真实记录，没发生的不写、没验证的标"待验证"。`,
    },
    phases,
    graduation: {
      checklist: [
        { text: 'JD 已分类并统计词频（≥30 条去重，并单独标注了门槛过高的反例 JD）', verify: '打开岗位地图，当场数出条数并指出反例' },
        { text: '个人能力差距清单每一条都对应真实 JD 原文', verify: '随机抽查 3 项，能说出它来自哪条 JD' },
        { text: '完成 ≥3 次真实访谈，纪要分开记录「用户原话 / 观察到的事实 / 我的解释」', verify: '打开 3 份纪要，三栏都填了' },
        { text: '用同一批测试样本（≥20 条，含 5 条 刁钻情况）比过 ≥3 个方案并留下分数', verify: '打开评分表，能看到逐项分数与归因' },
        { text: '优化前后结果可回查（保留了优化前的基线记录）', verify: '同时打开优化前后的两份记录' },
        { text: '作品可现场演示（有公开链接，别人能打开走通核心流程）', verify: '当场打开链接，请 1 个人走一遍' },
        { text: '真人试用记录如实（≥3 人，卡点和负面反馈也记了）', verify: '打开试用记录，能看到负面反馈' },
        { text: '简历可被解析，且每个数字都有原始记录', verify: '随机挑 3 个数字，能说出出自哪份材料' },
        { text: '面试题库与模拟面试完成（≥30 题提纲 + 3 次录音）', verify: '打开题库与录音文件' },
        { text: '投递漏斗按真实结果调整过（投了多少、回了几份、下一步改什么）', verify: '打开漏斗表，能看到依据结果做的调整' },
      ],
      judge3: [
        '能否用 3 分钟讲清目标场景：这个岗服务什么人、解决什么问题、为什么值得做。',
        '能否当场展示作品并说清取舍：为什么这么选、放弃了什么、它会在什么情况下失效。',
        '能否拿出测试与用户证据：评分表、试用记录、以及真实的投递回复（哪怕拒绝也算）。',
      ],
    },
  };
}

// 归一化路线任务：八字段结构 + 角色合法化 + 证据链接
function normalizeRoadmap(roadmap, roles, persona, topic, sources) {
  const rm = roadmap && typeof roadmap === 'object' ? roadmap : {};
  const phases = Array.isArray(rm.phases) ? rm.phases : [];
  const out = [];
  (phases || []).forEach((p, pi) => {
    const rawTasks = Array.isArray(p.tasks) ? p.tasks : [];
    const tasks = attachEv(normalizeActions(rawTasks, roles, persona, topic), rawTasks, sources);
    out.push({
      no: p.no || pi + 1,
      week: p.week || '',
      title: p.title || `第 ${p.no || pi + 1} 阶段`,
      focus: p.focus || '',
      phaseDone: p.phaseDone || '',
      tasks,
    });
  });
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    horizon: rm.horizon || routeHorizon(routeBucket(persona && persona.timePressure)),
    goal: rm.goal && rm.goal.text ? { text: rm.goal.text, basis: rm.goal.basis || '' } : { text: '', basis: '' },
    phases: out,
    graduation: rm.graduation || buildFallbackRoadmap([], persona, topic).graduation,
  };
}

// 根据自测反馈重做行动地图：把"最信哪一派 / 哪些盲区"喂给模型，生成贴合其辨向的"带终点完整路线"
export async function generateActions(secret, topic, roles, quizResult, persona = {}, sources = [], feedback = []) {
  const rs = Array.isArray(roles) ? roles : [];
  const fb = () => {
    const acts = fallbackActions(topic, persona, rs.length, quizBias(quizResult));
    return { ok: false, fallback: true, actions: acts, roadmap: buildFallbackRoadmap(acts, persona, topic) };
  };
  if (!hasSecret(secret) || !rs.length) return fb();
  const sideCounts = (quizResult && quizResult.sideCounts) || {};
  const uncertain = (quizResult && quizResult.uncertainSides) || [];
  const dominantArr = (quizResult && quizResult.dominant) || null;
  const dominantId = Array.isArray(dominantArr) ? dominantArr[0] : (dominantArr && dominantArr.top ? dominantArr.top[0] : null);
  const roleName = (id) => (rs.find((x) => x.id === id)?.name || id);
  const roleLines = rs.map((r) => `- ${r.id}（${r.name || r.form || r.id}）核心立场：${briefText(r.coreArg || r.stance || '', 60)}`).join('\n');
  const quizSummary = `用户自测结果：最偏向 ${dominantId ? roleName(dominantId) : '未明确'}；标了"不确定"的盲区视角：${uncertain.length ? uncertain.map(roleName).join('、') : '无'}。各派被倾向次数：${Object.entries(sideCounts).map(([k, v]) => `${k}:${v}`).join(', ') || '无'}`;
  const personaPrompt = `用户处境：阶段「${persona.identityName || persona.stageName || ''}」${persona.goalNames && persona.goalNames.length ? ` · 目标「${persona.goalNames.join('、')}」` : ''}${persona.city ? ` · 城市「${persona.city}」` : ''}${persona.timePressure ? ` · 时间「${persona.timePressure}」` : ''}。最困惑：${persona.confusion || topic}。`;
  const prompt = `你是"判断力陪练"，把用户的处境排成一份**带终点的完整行动路线**。
浓度标准（必须严格对齐用户认可的《转行自救指南（六周计划）》）：按周推进；每周都有「本周目标 → 学什么（输入）→ 做出什么（输出）→ 验收标准」四件事；每周都能交出一样求职时拿得出手的实物；终点是真实的求职动作。绝对不要输出一张张孤立的"验证卡片"或"了解一下 / 看看行情"这种空动作。
${personaPrompt}
第 0 步（最重要）：从用户这次最困惑的问题/目标里认出 ta 想投的**目标岗位**（如"数据分析师""AI产品经理""视频生成岗""内容运营"）。整条路线只围绕这个岗位真实展开：这个岗要什么样的人→你还差什么→做什么作品/证据能证明→怎么投。严禁套用建档行业或"AI产品经理/AIGC/校园AIGC项目"等默认设定，除非用户问的正是它；涉及工具、方法、验收物也只写这个岗位真实在用的。
已有立场：
${roleLines}
${quizSummary}${buildFeedbackBlock(feedback)}${routeCorpus(sources)}
【通用六周骨架（仅作节奏与产出模板，具体每周学什么、做什么作品、用什么工具，全部换成目标岗位真实在用的东西）】
第1周 岗位与行业认知：收集真实 JD → 产出《岗位地图》+《个人能力差距清单》→ 定下主赛道与备选赛道；
第2周 一手调研与基本功：做真实用户访谈或拆解真实案例 → 产出《调研/竞品报告》（含流程图与对比表）→ 为后面的作品选题；
第3周 评测与对比：做一批固定测试样本（含边界与 刁钻情况）→ 用同一批样本对比 ≥3 个方案/工具/做法 → 产出《评测/对比报告》并留下分数；
第4周 做出第一版作品：把选题做成能跑通的版本（输入→处理→产出→结果可核验）→ 记录优化前/后；
第5周 打磨与公开：补边界、异常与反例 → 找真人试用 → 产出可公开访问链接 + 测试记录；
第6周 求职冲刺：1 页可解析简历（每个数字都有原始记录）+ 面试题库 + 模拟面试 + 投递与复盘漏斗。
——骨架保证"每周都有实物，且能串成一条求职证据链"，最后一周能直接投出去。
【每周的推进感（这是内在要求，不是让你往步骤里套的字）】
每周的 steps 要能看出一条推进线：先拿输入（补一点必要的认知、拆一个真实的 JD/案例）→ 建立自己的第一版基线 → 做出本周的交付物 → 用 刁钻情况、异常输入、反例去砸它 → 交给真人验收并复盘。
但落到 steps 文字上时：每一步都用"这个岗位本周真实要做的动作"来命名（动宾短语，如"收集 30 条 JD""统计词频前十""找 3 个人试用"）。严禁出现"学 / 拆 / 练 / 做 / 补 / 验"这类统一标签，也不许每周都套同一套说法——第 1 周就该写"收 JD、分类、统计词频"，第 3 周就该写"建测试样本、跑三个方案、归因失败样本"。时间锚点可以自然带（如"本周前半""周末前"），但不要每步都强行标周一到周日。
【验收量级参考（照这个标准给数字，可以按他每周可投入的时间适度缩放，但必须有具体数字）】
岗位地图：≥30 条去重 JD（有余力到 100 条）+ 分类表 + 词频前十 +《个人能力差距清单》（目标要求/现有证据/差距/补强动作/完成日期/作品链接）；
调研访谈：≥3 次真实访谈（每次 ≥30 分钟）+ 访谈纪要（分开记录"用户原话""你观察到的事实""你的解释"）；
评测对比：固定测试样本 ≥20 条（10 条正常 + 5 条边界 + 5 条 刁钻情况），同一批输入比 ≥3 个方案，逐项 0~2 分，请第 2 人复评 ≥5 条，记录成本与耗时；
作品：1 个可公开访问链接 + ≥3 名真人试用记录（≥2 人能在 5 分钟内、无口头指导走通核心流程）+ 优化前后对比；
求职：1 页可被解析的 PDF 简历（所有数字有原始记录）+ ≥30 道面试题提纲 + ≥3 次录音模拟面试 + 投递复盘漏斗表（投递数/回复数/面试数，并按真实结果调整）。
严格要求：只返回一个 JSON 对象，不要任何额外文字、不要 markdown 代码块。
{
  "roadmap": {
    "horizon": "约 6 周",
    "goal": { "text": "终点卡：走到第几周交得出什么（如：一版能投的简历 + 已真实投出 N 份 + 能就自己的判断讲 3 分钟），要落在这个人的处境够得着，绝不写死待遇与成功率", "basis": "为什么定这个终点（引用他的时间压力 / 目标 / 最困惑）" },
    "phases": [
      { "no":1, "week":"第1周", "title":"本周目标（一句话）", "focus":"本周输入：学什么/查什么/收集什么", "phaseDone":"本周验收：做成什么算过，要能被现实核验",
        "tasks":[ {"when":"第1周","hypothesis":"要验证的关键判断","where":"去哪儿做（平台/渠道 + 搜什么关键词）","steps":"怎么做（分步、带数字）","done":"做完算成（交付物命名具体、带数量与验收点）","goSignal":"坚持信号","stopSignal":"收手信号","role":"r1","ev":["来源3"]} ] }
    ],
    "graduation": { "checklist":[{"text":"毕业检查项","verify":"拿什么现实反馈验"}], "judge3":["结束时只看的事1","2","3"] }
  }
}
约束：
1. 总时长按时间压力给建议：短于一星期→"约 2~3 周"；一个月左右→"约 6 周"（默认按《六周路线》排）；三个月以上或没填→"约 8~12 周"。写入 horizon。
2. 阶段数与 week 连续对齐 horizon：约 2~3 周→只给 3 个阶段（每段约 1 周）；约 6 周→正好 6 个阶段，week 依次为"第1周"…"第6周"；约 8~12 周→6 个阶段，week 写连续区间（如"第1~2周""第3~4周"…）。不许跳周，week 必须接满整个 horizon。
3. 每阶段排 1~2 条任务（全路线 6~12 条，宁精勿滥、不要堆条数），steps 按本周真实动作的先后顺序写，每步一句话、带数字，别注水；每步用动宾短语命名，不要套任何统一标签，也不要出现"学 / 拆 / 练 / 做 / 补 / 验"这类字眼。
4. 每周至少要有 1 条任务的 done 是"求职时拿得出手"的实物，命名具体并带数量与验收点（例如："《岗位地图》：≥30 条去重 JD + 四列分类表 + 词频前十""《调研报告》：3 次访谈纪要 + 数据流程图""《评测报告》：20 条测试样本 + 3 个方案逐项评分 + 刁钻情况 分类""作品：1 个可公开访问链接 + 3 人试用记录""简历：1 页可解析 PDF + 投递漏斗表"）。严禁用"了解一下""看看行情""持续关注"这类无法验收的说法充当交付。
5. 每条用 when/hypothesis/where/steps/done/goSignal/stopSignal/role 八字段。when 写周（如"第1周"）；steps 分步带数字；done 是可验证交付物；goSignal/stopSignal 是**能被现实结果判定**的具体信号（出现什么事实=该坚持/加码，出现什么事实=该收手/换路），严禁空话。
6. role 分配：先给你最信的一派 1~2 条（验证它是否站得住，role=${dominantId || 'r1'}）；盲区视角 ${uncertain.length ? uncertain.map((u) => roleName(u) + '(' + u + ')').join('、') : '无'} 每个至少 1 条；其余覆盖别的派。
7. ev 数组：事实性断言引用上方真实资料的【来源N】；引用不了或任务本身就是去拿一手事实的，写 "verify"。禁止凭空编造来源。
8. where 与 steps 必须出现这个岗位**真实在用的平台、工具与搜索关键词**（真实的招聘平台、真实的专业软件/工具、真实的社区或资料源），严禁只写"招聘网站""网上查查""相关平台"这类空渠道。
9. 每条任务都要有"反例意识"：steps 里必须包含"补 刁钻情况 / 异常状态 / 反例校验"这一步；goSignal 与 stopSignal 必须能被现实结果判定，不能是自我感觉。
10. graduation.checklist 给 8~10 项，每项 text + verify（拿什么现实反馈验），且每项都必须能"当场打开材料证明"（文件/作品/记录/对话/数据），按这个口径写：JD 已分类并统计词频、能力差距有真实证据、访谈与调研已完成、测试样本与 刁钻情况 已跑完并留分数、优化前后结果可回查、作品可现场演示、真人试用记录如实、简历可解析且每个数字有出处、面试题库与模拟面试完成、投递漏斗按真实结果调整过。不要"我觉得准备好了"这类空项；judge3 给 3 句"结束时只看这 3 件事"。`;

  const routeDigest = [persona.identityName || persona.stageName, persona.city, persona.timePressure,
    dominantId, (uncertain || []).join(',')].filter(Boolean).join('|');
  const startedAt = Date.now();
  const BUDGET = 85000; // 六周路线输出量大：单次直答放宽到 75s（云端跨洋链路慢），一次大机会为主（前端 120s 兜底）
  let json = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() - startedAt > BUDGET) break;
    // 仅在首轮快速失败（网络/解析类错误）时才重试；首轮已跑满超时的绝不重试，避免白耗双倍额度和等待
    if (attempt > 0 && Date.now() - startedAt > 8000) break;
    // 路线缓存同样要带处境与辨向：不同城市/时间压力/最信派别，路线本就该不同
    const r = await zhihuZhida(secret, prompt, OPENAI_MODEL, 600, `${topic}:route#${routeDigest}`, 75000);
    if (!r || !r.trim()) continue;
    try {
      const parsed = JSON.parse(extractJson(r));
      const ph = parsed && parsed.roadmap && parsed.roadmap.phases;
      const n = Array.isArray(ph) ? ph.reduce((a, p) => a + (Array.isArray(p.tasks) ? p.tasks.length : 0), 0) : 0;
      if (Array.isArray(ph) && ph.length >= 2 && n >= 6) { json = parsed; break; }
    } catch {}
  }
  if (!json) return fb();
  const roadmap = normalizeRoadmap(json.roadmap, rs, persona, topic, sources);
  if (!roadmap.phases.length || !flattenRoadmap(roadmap).length) return fb();
  return { ok: true, fallback: false, roadmap, actions: flattenRoadmap(roadmap) };
}

// 检索统筹统计：让前端直观看到「知乎 vs 全网」如何分工、各自贡献多少
function makeSearchStats({ queries, zhihuFound, webFound, zhihuChosen, webChosen, totalChosen, mode }) {
  const isFallback = mode === 'fallback';
  return {
    queries, zhihuFound, webFound, zhihuChosen, webChosen, totalChosen, mode: mode || 'normal',
    rationale: isFallback
      ? '知乎直答这会儿没连上，已切到「原始山径」：下面这些脚印都原样摆着，没再让人帮你挑一遍；哪些和你的处境像，你就重点看哪些。可信不可信，你自己拿主意。'
      : '知乎站内的讨论有真实赞数，分量更重，优先摆前面；站内不够的时候，再从全网找别的声音补上，好让你不只听到一面。',
  };
}

// 用真实角色生成 5 道自测题（兜底与"模型只返回一半"时共用）：
// 选项直接来自各派真实立场，并附一个「不确定」选项，避免自测变成二选一。
// 选项文案上限 30 字，保证在按钮里一行放得下（fallback-check 有对应断言）。
function quizFromItems(roles, topic) {
  const ref = (roles && roles.length ? roles : [{ id: 'r1', name: '一线从业者' }]).slice(0, 3);
  const templates = [
    { pre: '下面这条真实经验，你的第一反应更接近哪种说法？', fb: '想提醒你一句：你是在看道理，还是在看站队？', opt: (role) => optionText(role.stance || role.coreArg || role.name) },
    { pre: '这条经验在什么前提下才成立，超出该前提是否就失效？', fb: '想提醒你一句：你是不是把"在某条件下才成立"，当成了"放哪都对"？', opt: () => '它只在特定城市、资历和机会条件下成立' },
    { pre: '如果只看反对意见，下面哪条对这条经验的质疑最有力？', fb: '想提醒你一句：你是不是只听顺耳的那半边？', opt: (role) => `另一种观点提醒：${optionText(role.rebuts?.[0]?.text || role.rebuts?.[0]?.quote || role.stance || role.coreArg, 62)}` },
    { pre: '这条经验的结论最依赖哪个未经验证的前提？', fb: '想提醒你一句：你是不是把"想当然"当成了"本来如此"？', opt: () => '它成立的前提，是你的城市、资历和机会与案例接近' },
    { pre: '结合你的城市/时间压力/背景，这条经验对你当前处境的可借鉴度有多高？', fb: '想提醒你一句：你是不是在照搬别人的处境？', opt: () => '如果你的处境相近，这条观点才更值得参考' },
  ];
  return templates.map((tpl, i) => {
    const r = ref[i % ref.length];
    const opts = ref.map((role) => ({ label: tpl.opt(role), side: role.id }));
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
  const quiz = quizFromItems(roles, topic);

  const lowConfidence = (items || []).length < 3;
  const summary = lowConfidence
    ? `关于"${topic}"，知乎上直接相关的高赞讨论不多，下面这些是相近主题的真实回答，先拿来垫一垫——重点看哪些前提和你处境接近。`
    : `关于"${topic}"，知乎上有这些真实高赞讨论，看法并不一致——下面直接来自真实回答。`;

  const zhihuFound = (items || []).filter((it) => (it.source || 'zhihu') !== 'web').length;
  const webFound = (items || []).length - zhihuFound;

  return {
    ok: true, mock: false, fallback: true, lowConfidence,
    topic,
    usedHistory: (selected || []).map((s) => s.rec.topic), // 兜底模式也向前端说明本次参考了哪些历史。
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
    framework: { title: '信谁框架（来自真实讨论）', dimensions: dims },
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

// 自测按钮展示用的完整观点摘要：只截到可读长度，不截断到半句话。
function optionText(s, max = 86) {
  const t = String(s || '').trim().replace(/^该答主(认为|分享)：?/, '').trim();
  if (!t) return '这条观点的核心判断';
  const sentence = t.match(/^.{8,140}?[。！？.!?](?=\s|$)/)?.[0] || t;
  return sentence.length <= max ? sentence : `${sentence.slice(0, max)}…`;
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
      { title: `演示素材：「${q}」· 从 0 到 1 的实战路径`, summary: '这是演示模式的示例观点，不对应真实知乎文章。核心是先建立框架再补细节，避免一上来陷入信息过载。', url: '', voteUp: null, comment: null, authority: null, author: '演示数据', source: 'demo', demo: true, type: 'Answer' },
      { title: `演示素材：「${q}」· 常见的 5 个误区`, summary: '这是演示模式的示例观点，不对应真实知乎文章。误区一：盲目搜集资料；误区二：忽视反馈；误区三：用战术勤奋掩盖战略懒惰。', url: '', voteUp: null, comment: null, authority: null, author: '演示数据', source: 'demo', demo: true, type: 'Article' },
      { title: `演示素材：「${q}」· 面试官最看重的能力`, summary: '这是演示模式的示例观点，不对应真实知乎文章。不是背概念，而是能否把复杂问题拆成可执行步骤，并讲清取舍。', url: '', voteUp: null, comment: null, authority: null, author: '演示数据', source: 'demo', demo: true, type: 'Answer' },
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
    return '（还没接上知乎直答，现在给你看的是完整流程的示例。）';
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
  // 通用三派：用"谁在说"的真实身份，而不是按行业硬编码派系名。
  // 之前硬编码"刘看山·算法派"等只覆盖 8 个行业，其余退化成"技术派/业务派/资源派"，
  // 且把刘看山这个 IP 形象当成了某种立场的人。现在任何行业/岗位都成立。
  const fk = [`正在做${sub}的一线人`, `招过${sub}的面试官`, `从别的方向转进${sub}的人`];
  const formOf = ['一线从业者', '招聘视角', '转行过来人'];
  const mkSrc = (s, vote) => ({
    title: `演示脚印：「${sub}」· ${s}`,
    url: '',
    summary: `这是演示模式的示例观点，不对应真实知乎文章。用于体验「${topic}」的多角色对照流程。`,
    author: '演示数据',
    voteUp: null,
    source: 'demo',
    demo: true,
  });
  // PRD 9.1（11b）：mock 源头即带 matchReason，DEMO 直达 / catch / !raw 三条路径共用产物，一次补齐。
  // stageName 优先（对齐 alchemy 里 pt.identityName = stageName || ... 的归一化），城市/时间由 helper 守卫防重
  const matchReason = matchReasonFor({
    ...persona,
    identityName: persona.stageName || idName,
    industryName: ind,
    subName: sub,
  });
  const mk = (id, idx, name, stance, arg, bestFor, boundary, s1, s2, reb) => ({
    id, name, form: formOf[idx],
    persona: `${idName}视角下的${name}：在${ind}·${sub}里靠真功夫说话`,
    stance, coreArg: arg, bestFor, boundary,
    matchReason,
    sources: ['来源1', '来源2'],
    sourceItems: [mkSrc(s1, 3120), mkSrc(s2, 1800)],
    rebuts: reb,
  });
  const roles = [
    mk('r1', 0, fk[0],
      `在${sub}里先做出一个真实的小成果`,
      `想搞懂"${topic}"，对${idName}来说最有效的是先在${sub}里动手做一个真实的小尝试。你会在做的过程中撞到真问题，这些问题比任何高赞回答都更能帮你形成自己的判断。`,
      `${idName}、缺真实项目经历的人。`,
      '前提是这个尝试真问题驱动、有取舍思考，不能是跟风凑数。',
      '从0到1实战路径', '新手如何落地第一个项目',
      [{ to: 'r2', text: `光有框架没用，你不去真做"${topic}"，永远停在纸面，一上手就露怯。` }]),
    mk('r2', 1, fk[1],
      `先搭一个判断"${topic}"的行业框架`,
      `别急着冲进去。"${topic}"在${ind}·${sub}里水很深，先搭一个判断框架（目标—路径—风险）再行动，才不会被人带节奏。很多人不是不努力，是连"什么算做好"都没想清楚就盲动。`,
      `已有经历但表达混乱、容易被追问带偏的人。`,
      '前提是别只会背模型，要能现场把陌生问题拆出结构。',
      '最被低估的结构化能力', '如何把复杂问题拆清楚',
      [{ to: 'r1', text: `你闷头做"${topic}"却讲不清为什么，在懂行的人眼里就是瞎折腾。` },
       { to: 'r3', text: '方向当然重要，但光看方向不落地，你永远只是个"评论家"。' }]),
    mk('r3', 2, fk[2],
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
      summary: `在「${ind}·${sub}」领域，关于"${topic}"，同一个问题却有 ${fk.length} 种说法在打架——每种说法单独听都有它的道理，合起来却互相矛盾。${idName}最懵的，恰恰是"该信哪一种"。`,
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
        feedback: '三派互有盲区：一线的人怕"只干不想"，招聘方怕"看着漂亮扛不住追问"，转行的人怕"只问不干"。',
        analysis: '最狠的质疑通常是戳中"把一种工具当成全部答案"。每条质疑都有对应靶子，选择哪条取决于你认为当前讨论最缺什么。',
      },
      {
        scenario: `下面这三条理由里，哪一条**最依赖一个没被验证过的前提**？`,
        options: [
          { label: `"我做完一个小东西就能证明能力"`, side: 'r1' },
          { label: `"这个方向缺人，所以门槛不会太高"`, side: 'r2' },
          { label: `"转行过来的人更能吃苦，所以有优势"`, side: 'r3' },
        ],
        prompt: '你站哪边？',
        feedback: '这题在考：你能不能分清"事实"和"我假设它是事实"。',
        analysis: '三条都能成立，但各自依赖不同前提：作品是否被这个方向认可、缺人是否等于门槛低、能吃苦是否是可迁移的竞争力。先去验证前提，再谈结论。',
      },
      {
        scenario: `结合你的处境` + (city ? `（${city}）` : '') + (timeP ? `、时间压力「${timeP}」` : '') + `，眼下你最该先采信哪一种说法？`,
        options: [
          { label: `先听一线的：做出东西再说，别空想`, side: 'r1' },
          { label: `先听招聘方的：搞清门槛再投入，别白跑`, side: 'r2' },
          { label: `先听转行过来人的：搞清这条路到底通不通`, side: 'r3' },
        ],
        prompt: '你站哪边？',
        feedback: '这题没有标准答案，考的是"你现在的处境最缺哪一块"。',
        analysis: timeP
          ? `你填的时间压力是「${timeP}」：时间越紧，越该先搞清门槛（招聘方视角），避免把有限时间投在进不去的方向上。`
          : `时间越紧越该先搞清门槛（招聘方视角），时间宽裕才值得先做一个完整作品（一线视角）。`,
      },
    ],
    actions: (() => {
      const bucket = routeBucket(timeP);
      const whens = bucket === 'urgent' ? ['今天', '今天', '本周', '本周']
        : bucket === 'short' ? ['今天', '本周', '本周', '本月']
          : ['本周', '本月', '本月', '三个月内'];
      const inCity = city ? `（${city}）` : '';
      return [
        {
          when: whens[0],
          hypothesis: `我现在的背景，在「${confusion}」这件事上是加分，不是硬伤`,
          where: `BOSS直聘 / 实习僧 / 拉勾 / LinkedIn，搜「${sub}」` + (city ? `，地点选${city}` : ''),
          steps: `1. 搜「${sub}」收集 5 条真实 JD；2. 摘出出现最多的 3 个硬性要求（学历 / 工具 / 项目）；3. 把自己的背景逐条对照，标"已满足 / 部分满足 / 不满足"；4. 把最不匹配的 1 条单独记下来`,
          done: `《岗位对照表》1 份：5 条 JD 链接或截图 + 3 个硬性要求 + 自身对照结果`,
          goSignal: `若 5 条里有 3 条以上的要求你能对上，说明这个方向够得着，继续往下做`,
          stopSignal: `若 5 条几乎都卡在同一个你短期补不上的硬门槛，先换相邻方向，别硬撞`,
          role: 'r2',
        },
        {
          when: whens[1],
          hypothesis: `真正在做这件事的人，说的和我想的不一样`,
          where: `脉脉 / 知乎 / 小红书 / 校友群${inCity}，找正在做「${sub}」的人`,
          steps: `1. 写一段 50 字自我介绍 + 请教请求；2. 同时约 3 位从业者；3. 争取 2 次 15 分钟以上对话；4. 只问"你当时最难过的那道坎是什么、重来一次会先做什么"`,
          done: `《访谈纪要》1 份：2 位过来人 + 每人 3 个关键问答 + 至少 1 条和你原本想的不一样的发现`,
          goSignal: `若对方给的动作具体可落地，且至少 1 人说"你这种背景有机会"`,
          stopSignal: `若多数说"现在基本不招"或建议互相矛盾，说明信息还不足，先补认知再行动`,
          role: 'r1',
        },
        {
          when: whens[2],
          hypothesis: `我能交出一样"求职时拿得出手"的小东西`,
          where: `你熟悉的文档工具（飞书 / Notion / 语雀）+ 公开平台（知乎 / 即刻）`,
          steps: `1. 挑 1 个你真熟悉的小问题；2. 写 1 页方案（问题 → 怎么解决 → 要什么数据 → 怎么算做成）；3. 发给 1 位从业者或公开求反馈；4. 收集 3 条反馈并改掉 1 处`,
          done: `最小作品 1 份：1 页方案 + 3 条反馈记录 + 1 处修改说明`,
          goSignal: `若对方说"思路对""点抓得准"，或你自己写的时候不卡壳`,
          stopSignal: `若连"它到底解决什么问题"都讲不清，先补基本功再动手做`,
          role: 'r3',
        },
        {
          when: whens[3],
          hypothesis: `我能用一手事实，把最关键的那个判断验证掉`,
          where: `上面几步的证据 + 招聘平台（真实投递）`,
          steps: `1. 把上面 3 步的结论写成 3 条判断；2. 每条配 1 条现实证据（JD / 访谈原话 / 反馈）；3. 用 STAR 写成 1 页简历；4. 真实投出 5 份并记录回复情况`,
          done: `求职包 1 套：3 条判断 + 对应证据 + 1 页简历 + 投递记录（≥5 份）`,
          goSignal: `若拿到至少 1 次回复，或有人愿意聊你的作品`,
          stopSignal: `若投出 5~10 份零回复，先收窄到一个主赛道重投，而不是继续海投`,
          role: 'r1',
        },
      ];
    })(),
    sources: MOCK.search(topic),
  };
}
