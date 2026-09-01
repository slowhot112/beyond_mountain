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
  const r = await fetch(url, { headers: authHeaders(secret) });
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
export async function zhihuZhida(secret, prompt, model = OPENAI_MODEL, ttl = 600) {
  if (!hasSecret(secret)) return MOCK.zhida(prompt);
  const ck = `zhida:${model}:${hash(prompt)}`;
  const hit = await cacheGet(ck);
  if (hit) return hit;
  try {
    const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(secret),
      // 06 实测 2026-08-30：直答偶发 25s TimeoutError（第 2 次同载荷成功），放宽到 60s 给慢响应留空间（60s 在 Railway/Render 代理限制内）
      signal: AbortSignal.timeout(60000),
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
    await cacheSet(ck, text, ttl);
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

// ---------- 4. 判断力炼金包：搜索 + 直答 组合（核心） ----------
// 多角色对照（B1 伪多 Agent）：单次调用产出多个有独立人设的虚拟答主，各自基于知乎内容给视角并互相质疑。
// 不综合结论，保留张力；单次调用零额外额度消耗。
// persona = { identity, industry, sub }（由前端 src/lib.js 的 personaPayload 提供）
export async function alchemy(secret, topic, persona = { identity: 'pre', industry: 'ai', sub: 'AIGC' }, queries = []) {
  if (!hasSecret(secret)) return MOCK.alchemy(topic, persona); // 演示模式：返回精美示例，保证"打开即完整"
  const pt = (typeof persona === 'string')
    ? { identity: 'pre', industry: 'ai', sub: 'AIGC', prompt: '' }
    : persona;
  // 归一化：新处境卡字段（stageName/goalNames）映射到旧字段名，供 topicMock / prompt 模板兼容
  pt.identityName = pt.stageName || pt.identityName || ({ pre: '准入行', grad: '应届求职', unemployed: '待业求职', watch: '在职观望', deepen: '在职深耕', shift: '转行转岗', offer: 'Offer决策' }[pt.stage] || pt.identity || '准入行');
  pt.industryName = pt.industryName || pt.industry;
  pt.subName = pt.subName || pt.sub;
  const personaPrompt = pt.prompt || `你是「${pt.identityName}」的人，行业「${pt.industryName}」，细分「${pt.subName}」。`;
  // 模块④：检索词结合处境卡（并发搜索 + 精简语料，减少等待）
  const qs = (queries && queries.length) ? queries.slice(0, 3) : [topic];
  const searchResults = await Promise.allSettled(qs.map((q) => zhihuSearch(secret, q, 4)));
  let items = [];
  searchResults.forEach((r) => { if (r.status === 'fulfilled' && Array.isArray(r.value)) items = items.concat(r.value); });
  // 去重：同一篇文章可能以不同 url/不同赞数出现多次，按归一化标题保留赞数最高的一条
  const titleBest = new Map();
  items.forEach((it) => {
    const t = normTitle(it.title);
    if (!t) return;
    const cur = titleBest.get(t);
    if (!cur || (it.voteUp || 0) > (cur.voteUp || 0)) titleBest.set(t, it);
  });
  items = Array.from(titleBest.values());
  const corpus = items
    .slice(0, 6)
    .map((it, i) => `【来源${i + 1}·${it.voteUp || 0}赞】${it.title}\n${it.summary}`)
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

  const prompt = `你是一个"判断力陪练"教练，而不是总结机器。${personaPrompt}${contextBlock}
围绕主题"${topic}"，基于下面来自知乎真实高赞讨论的内容，帮这个具体身份的人看清分歧、长出自己的判断。

严格要求：只返回一个 JSON 对象，不要任何额外文字、不要 markdown 代码块。

{
  "topic": "一句话主题",
  "conflict": {
    "summary": "一句话说明分歧为何对这个人真实存在",
    "roles": [
      {
        "id": "r1",
        "name": "刘看山·贴合该行业的派别名",
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
    {"scenario": "情境题1：直接来自用户最困惑的问题，测试第一反应更接近哪一派", "options": [{"label": "选项", "side": "r1"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"},
    {"scenario": "情境题2：识别某派观点的边界/前提，什么时候它不成立", "options": [{"label": "选项", "side": "r2"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"},
    {"scenario": "情境题3：判断不同角色互驳时，哪条质疑最有力", "options": [{"label": "选项", "side": "r3"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"},
    {"scenario": "情境题4：哪条论据最弱、最依赖未经验证的前提", "options": [{"label": "选项", "side": "r1"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"},
    {"scenario": "情境题5：在用户的城市/时间压力/背景下，该优先采信哪一派建议", "options": [{"label": "选项", "side": "r2"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"}
  ],
  "actions": [
    {"task": "今天就能做的1件小事（具体、可验证）", "why": "为什么对当前处境有用"},
    {"task": "本周内完成的1个信息收集动作（带城市/时间限定）", "why": "为什么能打破信息差"},
    {"task": "下周前落地的1次真实反馈/验证（可约人、可查数据）", "why": "为什么比空想更有效"}
  ]
}

约束：只返回 JSON；roles 2~4 个；每个角色必须有 matchReason 和至少 1 条 sources；rebuts 至少质疑另一角色；内容紧紧围绕该身份与行业。不同角色引用的 sources 尽量不要重复；若真实来源不足，宁可让角色少引一篇，也不要把同一篇文章硬塞给多个角色。quiz 必须包含 5 道题，分别测：1)第一反应/本能立场；2)边界识别（什么时候某派不成立）；3)互驳判断（哪条质疑最有力）；4)论据可信度（哪条最依赖未验证前提）；5)处境取舍（在目标城市/时间压力/背景下该优先采信谁）。每题 options 数量与 roles 数量一致，side 用角色 id（r1/r2/r3...），必须有 feedback 和 analysis，不要有 correctSide 这种标准答案字段。行动地图必须给出 3~5 条 task，每条必须结合用户的「目标城市 / 时间压力 / 最困惑 / 背景摘要」给出可执行、可验证、带地点与时间限定的具体动作，不要泛泛而谈；时间压力短于一星期时粒度为"2小时内/今天/本周"，一个月左右为"今天/本周/本月"，三个月以上为"本周/本月/三个月内"，未填时间时第一条任务必须是"明确时间窗口"。quiz 第 1 题的情境必须直接来自用户最困惑的问题与真实处境，而非通用话术。

内容：
${corpus || '（无检索结果，请基于该行业常识生成）'}`;

  // matchReason 模板用模块级 matchReasonFor（11b 从此处的局部 helper 提升：topicMock 源头也需复用）

  // 调用直答：最多重试 3 次，提升"角色数达标 + 可解析"的成功率（避免偶发格式错误就退回关键词模板）
  let json = null;
  let roles = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const aug = attempt === 0
      ? prompt
      : prompt + '\n\n（务必只返回合法 JSON，且 conflict.roles 至少 2 个，每个含 id/name/coreArg/sources/matchReason；不要任何额外文字。）';
    const r = await zhihuZhida(secret, aug);
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
    return realDataFallback(items, topic, pt);
  }

  // 角色数仍 <2：用真实搜索结果补全（而非模板）
  if (!roles || roles.length < 2) {
    const realRoles = rolesFromItems(items, pt, roles);
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
      }));
    }
    return { ...r, matchReason: reason, sourceItems: srcItems };
  });

  return {
    ok: true, mock: false,
    ...json,
    conflict: { ...(json.conflict || {}), roles },
    sources: items.slice(0, 6),
  };
}

// 用真实搜索结果构造角色（兜底/补全用，绝不出现关键词模板）
function rolesFromItems(items, pt, existing = []) {
  const seed = (existing || []).map((r, i) => ({ ...r, id: r.id || `r${i + 1}` }));
  const used = new Set(seed.map((r) => r.id));
  const out = [...seed];
  (items || []).slice(0, 4).forEach((it, i) => {
    const id = `r${i + 1}`;
    if (used.has(id)) return;
    const titleBrief = briefText(it.title, 50) || '知乎答主';
    const summaryBrief = briefText(it.summary, 120) || titleBrief;
    out.push({
      id,
      name: titleBrief,
      form: it.author || '知乎答主',
      side: '',
      avatar: '🐻‍❄️',
      persona: `来自知乎真实讨论：${briefText(it.title, 80)}`,
      stance: titleBrief,
      coreArg: summaryBrief,
      bestFor: '关注该角度真实经验的人',
      boundary: '代表该答主个人观点，需结合你自己处境判断',
      matchReason: matchReasonFor(pt),
      sources: [`来源${i + 1}`],
      sourceItems: [it],
      rebuts: [],
    });
    used.add(id);
  });
  return out;
}

// 根据处境卡的时间压力，给兜底行动地图排优先级和粒度
function fallbackActions(topic, pt, rolesLen) {
  const goalTxt = (pt.goalNames && pt.goalNames.length) ? pt.goalNames.join('、') : '';
  const city = pt.city || '';
  const tp = String(pt.timePressure || '').trim();
  const baseRead = `浏览下面 ${Math.max(1, Math.min(3, rolesLen))} 篇"${topic}"知乎原文，只记录一条与你处境最相关的具体信息`;

  let core = [];
  if (!tp || tp.match(/暂无|不明|没|不|不确定|^\s*$/)) {
    // 用户没填时间：先帮他明确时间窗口，再给通用动作
    core = [
      { task: `今天花 10 分钟明确你的时间窗口：是 1 周内、1 个月内还是 3 个月以上？写进处境卡`, why: '没有时间压力，行动计划就无法排序；先把这个空补上。' },
      { task: `今天花 15 分钟${baseRead}`, why: '先把“收藏”变成“记录”，才能进入判断。' },
      { task: `本周内针对"${topic}"找到 1 个可验证的事实（如岗位 JD/行业报告/薪资数据）`, why: '用一手事实替代泛泛印象，是长判断力的最快方式。' },
    ];
  } else if (tp.match(/一\s*周|1\s*周|7\s*天|七\s*天|三\s*天|3\s*天|24\s*小|马上|立|急/)) {
    core = [
      { task: `接下来 2 小时内${baseRead}`, why: '时间只剩不到一周，先把信息差补到能下判断的最小单位。' },
      { task: `今天下班前，用 30 分钟写下"如果必须今晚做决定，我会选哪一派、凭什么"`, why: '极端时间压力下，先逼自己产出判断草稿，再迭代。' },
      { task: `本周结束前，找到 1 个能验证或推翻你当前偏向的事实（一个电话/一份 JD/一个数据）`, why: '短期决策最怕凭感觉，一手事实比反复纠结有效。' },
    ];
  } else if (tp.match(/一\s*月|1\s*月|30\s*天|一\s*个\s*月/)) {
    core = [
      { task: `今天花 15 分钟${baseRead}`, why: '先把“收藏”变成“记录”，才能进入判断。' },
      { task: `本周内做 1 次小范围验证（投 3 份简历 / 约 1 次信息访谈 / 做 1 个最小尝试）`, why: '一个月足够拿到真实反馈，不要只停留在看文章。' },
      { task: `本月结束前，整理出"适合我"和"不适合我"的两条明确判断标准`, why: '用标准替代感觉，减少最后一周的焦虑。' },
    ];
  } else {
    // 三个月及以上 / 长期
    core = [
      { task: `本周内${baseRead}，并标出哪些前提和你的处境最像`, why: '长期窗口下，先建立判断坐标系，再行动。' },
      { task: `本月内做 1 个为期 2 周的最小尝试（副业 / 课程 / 项目 / 实习）`, why: '三个月以上最值得做的是低成本试错，而不是继续收集文章。' },
      { task: `三个月内，用这次尝试的反馈决定是否正式转向`, why: '长期目标需要阶段性验收，避免无限拖延。' },
    ];
  }

  if (city) {
    core.push({ task: `在${city}找 1 位正在做"${topic}"相关岗位的人聊 15 分钟`, why: '本地真实反馈比泛泛高赞更贴你处境。' });
  }
  return core.slice(0, 5);
}

// 直答彻底失败时的真实数据兜底：仍返回合法结构，内容全部来自真实知乎搜索
// export：供 scripts/fallback-check.mjs 做回归断言（长文截断 + 选项数量）
export function realDataFallback(items, topic, pt) {
  const roles = rolesFromItems(items, pt);
  const dims = [
    { dim: '看高赞但不盲从', guide: '点开下面每篇知乎原文，看高赞答主到底凭什么立论，而非只记结论。' },
    { dim: '看反对与边界', guide: '专门找和你直觉相反的回答，想想它成立的前提是什么。' },
    { dim: '看最新一线实践', guide: '优先读近一年的回答，过时的行业判断可能已经变天。' },
  ];
  const ref = (roles.length ? roles : [{ id: 'r1', name: '知乎答主' }]).slice(0, 3);
  const quizTemplates = [
    { pre: '下面这条真实经验，你的第一反应更接近谁？', fb: '想逼出的盲区：你是在看论证，还是在看立场？' },
    { pre: '这条经验在什么前提下才成立，超出该前提是否就失效？', fb: '想逼出的盲区：你是否把“特定条件下成立”当成了“普遍真理”？' },
    { pre: '如果只看反对意见，下面哪条对这条经验的质疑最有力？', fb: '想逼出的盲区：你是否只收集支持自己的证据？' },
    { pre: '这条经验的结论最依赖哪个未经验证的前提？', fb: '想逼出的盲区：你是否把假设当成了事实？' },
    { pre: '结合你的城市/时间压力/背景，这条经验对你当前处境的可借鉴度有多高？', fb: '想逼出的盲区：你是否在照搬别人的处境？' },
  ];
  const quiz = quizTemplates.map((tpl, i) => {
    const r = ref[i % ref.length];
    const titleShort = briefText(r.stance || r.name, 26);
    const opts = ref.map((role) => ({
      label: briefText(role.stance || role.name || role.id, 26),
      side: role.id,
    }));
    // 加一个「不确定」选项，让自测不只是二选一
    opts.push({ label: '不确定 / 还没想清楚', side: null });
    return {
      // 题干只给问题 + 文章标题，正文摘要交给「主流观点」卡片，避免题目本身变成一堵墙
      scenario: `关于"${topic}"，${tpl.pre} 参考《${titleShort}》`,
      options: opts,
      prompt: '你更倾向哪一边？',
      feedback: tpl.fb,
      analysis: `对照《${r.stance || r.name}》的具体前提再判断。`,
    };
  });

  const lowConfidence = (items || []).length < 3;
  const summary = lowConfidence
    ? `关于"${topic}"，知乎上直接相关的高赞讨论不多，下面这些内容由相近主题的真实回答兜底——你可以把它们当成“旁听素材”，重点看哪些前提和你处境接近。`
    : `关于"${topic}"，知乎上有这些真实高赞讨论，看法并不一致——下面直接来自真实回答。`;

  return {
    ok: true, mock: false, fallback: true, lowConfidence,
    topic,
    conflict: { summary, roles },
    framework: { title: '信谁框架（真实数据兜底）', dimensions: dims },
    quiz,
    actions: fallbackActions(topic, pt, roles.length),
    sources: (items || []).slice(0, 6),
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
      { task: `围绕"${confusion}"，` + (city ? `在${city}的` : '在') + `${sub}里找一个真实对象，写下它的 3 个痛点并各给一个改进方案。`, why: '同时练框架拆解 + 输出，检验你到底"听得懂"还是"做得出"。' },
      { task: `找 1 位${sub}在行的人做 15 分钟信息访谈` + (city ? `（优先${city}本地）` : '') + `，只问："你判断${confusion}最看重什么？"`, why: '用真实视角校准"该信哪派"，别只在知乎高赞里打转。' },
      { task: `用 STAR 法准备 1 个关于"${confusion}"的${sub}小故事` + (edu ? `（结合你的背景：${edu.slice(0, 36)}…）` : '') + `，讲 3 分钟并录下来听一遍。`, why: '把实干家的弹药变成谋略家也能听懂的结构化表达。' },
    ],
    sources: MOCK.search(topic),
  };
}
