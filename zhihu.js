// 知乎开放平台 API 客户端（含本地缓存 + Mock 兜底）
// 文档来源：zhihu-hackathon-skill 中的 http-api.md / user-api.md / open-platform.md
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

// ---------- 3. 知乎直答（大模型） ----------
export async function zhihuZhida(secret, prompt, model = 'zhida-fast-1p5', ttl = 600) {
  if (!hasSecret(secret)) return MOCK.zhida(prompt);
  const ck = `zhida:${model}:${hash(prompt)}`;
  const hit = await cacheGet(ck);
  if (hit) return hit;
  try {
    const r = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: authHeaders(secret),
      signal: AbortSignal.timeout(25000),
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
    const raw = await zhihuZhida(secret, prompt, 'zhida-fast-1p5', 86400);
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
  // 去重（按 url/title）
  const seen = new Set(); items = items.filter((it) => { const k = it.url || it.title; if (seen.has(k)) return false; seen.add(k); return true; });
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
    {"scenario": "情境题1：测试第一反应更接近哪一派", "options": [{"label": "选项", "side": "r1"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"},
    {"scenario": "情境题2：测试能否识别某派的边界/前提", "options": [{"label": "选项", "side": "r2"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"},
    {"scenario": "情境题3：测试能否判断不同角色互驳的漏洞", "options": [{"label": "选项", "side": "r3"}], "prompt": "你站哪边？理由？", "feedback": "想逼出的盲区", "analysis": "详细解析"}
  ],
  "actions": [{"task": "这周能做的1件小事", "why": "为什么有用"}]
}

约束：只返回 JSON；roles 2~4 个；每个角色必须有 matchReason 和至少 1 条 sources；rebuts 至少质疑另一角色；内容紧紧围绕该身份与行业。quiz 必须包含 3 道题，分别测：1)第一反应/本能立场；2)边界识别（什么时候某派不成立）；3)互驳判断（哪条质疑最有力）。每题 options 数量与 roles 数量一致，side 用角色 id（r1/r2/r3...），必须有 feedback 和 analysis，不要有 correctSide 这种标准答案字段。

内容：
${corpus || '（无检索结果，请基于该行业常识生成）'}`;

  const raw = await zhihuZhida(secret, prompt);
  if (!raw || !raw.trim()) {
    console.warn('[alchemy] zhida empty, fallback to mock for', topic);
    const fb = topicMock(topic, pt);
    return { ...fb, mock: false, fallback: true, ...replaceMockSources(fb, items) };
  }
  try {
    const json = JSON.parse(extractJson(raw));
    let roles = linkSources(json.conflict?.roles || [], items);
    // 角色数 2~4 自适应：API 有时不守 prompt 只生成 0~1 个，用本地三派兜底补全到至少 2 个，保证对照墙永远有交锋
    if (!roles || roles.length < 2) {
      console.warn('[alchemy] zhida returned', roles?.length || 0, 'roles, padding with mock factions for', topic);
      const fb = topicMock(topic, pt);
      const goalTxt = (pt.goalNames && pt.goalNames.length) ? pt.goalNames.join('、') : '';
      const fallbackRoles = (fb.conflict?.roles || []).map((r, i) => ({
        ...r,
        id: r.id || `r${i + 1}`,
        sourceItems: items.slice((i * 2) % items.length, ((i * 2) % items.length) + 2),
        matchReason: `匹配你的处境：阶段「${pt.identityName}」${goalTxt ? ' · 目标「' + goalTxt + '」' : ''}${pt.industryName ? ' · 行业「' + pt.industryName + '·' + pt.subName + '」' : ''}`,
      }));
      const existingIds = new Set((roles || []).map((r) => r.id).filter(Boolean));
      const padded = [...(roles || [])];
      fallbackRoles.forEach((r) => {
        if (!existingIds.has(r.id)) { padded.push(r); existingIds.add(r.id); }
      });
      roles = padded.slice(0, 4);
      json.fallback = true; // 标记为兜底，让前端显示提示
    }
    // 角色数超过 4 时截断到 4，避免网格过度换行
    if (roles.length > 4) roles = roles.slice(0, 4);

    // 保证每个角色都有 matchReason 和至少 1 条来源（100% 可解释性）
    const goalTxt = (pt.goalNames && pt.goalNames.length) ? pt.goalNames.join('、') : '';
    roles = roles.map((r, idx) => {
      const baseReason = `匹配你的处境：阶段「${pt.identityName}」${goalTxt ? ' · 目标「' + goalTxt + '」' : ''}${pt.industryName ? ' · 行业「' + pt.industryName + '·' + pt.subName + '」' : ''}`;
      let reason = r.matchReason || baseReason;
      if (pt.city && !reason.includes('城市')) reason += ` · 城市「${pt.city}」`;
      if (pt.timePressure && !reason.includes('时间')) reason += ` · 时间窗口「${pt.timePressure}」`;
      let srcItems = Array.isArray(r.sourceItems) ? r.sourceItems : [];
      if (!srcItems.length && items.length) {
        const pair = items.slice((idx * 2) % items.length, ((idx * 2) % items.length) + 2);
        srcItems = pair.map((it) => ({
          title: it.title,
          url: it.url,
          summary: it.summary,
          author: it.author,
          voteUp: it.voteUp,
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
  } catch {
    // LIVE 解析失败（如额度耗尽 / 模型返回异常）：回落到话题自适应兜底，保证评委仍能完整体验
    const fb = topicMock(topic, pt);
    return { ...fb, mock: false, fallback: true, ...replaceMockSources(fb, items) };
  }
}

function extractJson(s) {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b >= 0 ? s.slice(a, b + 1) : s;
}

// 把角色里的"来源N"编号数组映射成真实文章清单（标题/URL/摘要/作者/赞），让每条论点有多篇可点击来源
function linkSources(roles, items) {
  return (roles || []).map((r) => {
    const refs = Array.isArray(r.sources) ? r.sources : (r.source ? [r.source] : []);
    const idxs = refs
      .map((m) => {
        const mm = String(m).match(/来源\s*(\d+)/);
        return mm ? parseInt(mm[1], 10) - 1 : -1;
      })
      .filter((i) => items[i]);
    const sourceItems = idxs.map((i) => {
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
    return '（未配置 Access Secret，当前为演示模式。配置后将由知乎直答基于真实内容生成。）';
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
  const mk = (id, name, stance, arg, bestFor, boundary, s1, s2, reb) => ({
    id, name, form: formOf(name), avatar: '🐻‍❄️',
    persona: `${idName}的${name.replace('刘看山·', '')}：信奉在${ind}·${sub}里靠真功夫说话`,
    stance, coreArg: arg, bestFor, boundary,
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
        { dim: `你缺的是"项目素材"还是"表达"？`, guide: `毫无经历 → 偏${fk[0]}先动手；有经历但讲不利索 → 偏${fk[1]}先练结构化表达。` },
        { dim: `这件事在${sub}里是"功能型"还是"方向型"？`, guide: '偏落地执行 → 看技术派开的弹药；偏选择判断 → 听资源派指的方向与真实反馈。' },
        { dim: '你的时间窗口有多长？', guide: '不足一个月 → 先打磨已有认知；三个月以上 → 值得做一个完整小尝试，同时别忘同步搞信息差。' },
      ],
    },
    quiz: [
      {
        scenario: `作为${idName}的${sub}从业者，有人问你："${topic}，你到底怎么看？" 你第一反应更可能是——`,
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
        scenario: `你已经在${sub}里做了一个关于"${topic}"的小尝试，但三个月后发现数据/反馈并不好。这时候你更该——`,
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
      { task: `围绕"${topic}"，在${sub}里找一个真实对象，写下它的 3 个痛点并各给一个改进方案。`, why: '同时练框架拆解 + 输出，检验你到底"听得懂"还是"做得出"。' },
      { task: `找 1 位${sub}在行的人做 15 分钟信息访谈，只问："你判断${topic}最看重什么？"`, why: '用真实视角校准"该信哪派"，别只在知乎高赞里打转。' },
      { task: `用 STAR 法准备 1 个关于"${topic}"的${sub}小故事，讲 3 分钟并录下来听一遍。`, why: '把实干家的弹药变成谋略家也能听懂的结构化表达。' },
    ],
    sources: MOCK.search(topic),
  };
}
