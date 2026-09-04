// 共享数据与工具函数（从原 app.js 平移，改用 ES 模块导出）

// ---------- 统一 API 客户端（REST envelope：{ok, data} / {ok, code, message}） ----------
// 默认 50s 超时（覆盖后端 alchemy 最坏 ~40s 兜底），避免慢请求下按钮一直转圈
export async function api(path, opts = {}) {
  const timeout = opts.timeout || 70000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path, { ...opts, signal: opts.signal || ctrl.signal });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || json.error || '请求失败');
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 热榜灵感（工单03）：统一热榜 fetch 封装 ----------
// 成功返回 { mock, topics }（topics 为去重后的话题文本数组）；任何失败/超时/空数据都抛错，
// 调用方（Onboarding）catch 后静默降级——不渲染 chip 区，绝不阻断建档。
export async function fetchHotTopics(timeoutMs = 6000) {
  const data = await api('/api/hot', { signal: AbortSignal.timeout(timeoutMs) });
  const items = Array.isArray(data?.items) ? data.items : [];
  const topics = [...new Set(items.map((it) => String(it?.title || '').trim()).filter(Boolean))];
  if (!topics.length) throw new Error('热榜为空');
  return { mock: !!data.mock, topics };
}

// ---------- 模块①：处境卡字段定义（对齐 PRD 模块1） ----------
export const STAGES = [
  { id: 'explore', name: '在校探索' },
  { id: 'grad', name: '应届求职' },
  { id: 'unemployed', name: '待业求职' },
  { id: 'watch', name: '在职观望' },
  { id: 'deepen', name: '在职深耕' },
  { id: 'shift', name: '转行转岗' },
  { id: 'offer', name: 'Offer 决策' },
];

export const GOALS = [
  { id: 'intern', name: '找实习' },
  { id: 'fulltime', name: '找全职' },
  { id: 'company', name: '换公司' },
  { id: 'role', name: '换岗位' },
  { id: 'industry', name: '换行业' },
  { id: 'study', name: '升学与就业决策' },
  { id: 'compare', name: '比较 Offer' },
  { id: 'unknown', name: '暂未明确' },
];

// 预设行业（可手填补充，不限于此）
export const INDUSTRIES = [
  { id: 'ai', name: 'AI / 人工智能', subs: ['算法', 'Agent', 'AIGC', 'AI 产品', '模型训练', '数据标注', '大模型应用', 'MLOps'] },
  { id: 'live', name: '直播 / 短视频', subs: ['直播运营', '主播', '直播助理', '场控', '选品', '投流', '短视频编导', 'MCN'] },
  { id: 'finance', name: '金融', subs: ['投行', '量化', '风控', '财富管理', '行研', '保险', '基金', '券商', '银行'] },
  { id: 'media', name: '传媒 / 内容', subs: ['内容运营', '编导', '媒介', '公关', '短视频', '品牌', '新媒体', '广告'] },
  { id: 'it', name: 'IT / 互联网', subs: ['前端', '后端', '产品', '测试', '运维', '数据', '算法工程师', '项目经理', 'UI/UX'] },
  { id: 'hr', name: 'HR / 人力', subs: ['招聘', 'OD', '薪酬绩效', 'HRBP', '培训', '员工关系', '猎头'] },
  { id: 'sport', name: '运动 / 体育', subs: ['教练', '赛事运营', '运动康复', '体能', '场馆', '青训', '体育营销'] },
  { id: 'logistics', name: '物流 / 供应链', subs: ['供应链', '仓储', '运力', '跨境物流', '冷链', '仓配', '采购'] },
  { id: 'edu', name: '教育', subs: ['教师', '教研', '课程设计', '留学', '教培运营', '高校行政'] },
  { id: 'medical', name: '医疗 / 健康', subs: ['临床', '医药代表', '医疗器械', '健康管理', '护理', '医美'] },
  { id: 'law', name: '法律', subs: ['律师', '法务', '合规', '知识产权', '公检法'] },
  { id: 'design', name: '设计', subs: ['视觉设计', '工业设计', '交互设计', '游戏美术', '建筑'] },
  { id: 'manufacture', name: '制造 / 工业', subs: ['工艺', '质量', '生产管理', '嵌入式', '自动化'] },
  { id: 'consult', name: '咨询 / 研究', subs: ['战略咨询', '市场研究', '用户研究', '数据分析', '行业研究'] },
  { id: 'civil', name: '体制内 / 国企', subs: ['公务员', '事业单位', '央企', '选调生', '军工'] },
  { id: 'consumer', name: '消费 / 零售', subs: ['电商', '品牌营销', '门店运营', '买手', '用户增长'] },
  { id: 'realestate', name: '房地产 / 建筑', subs: ['地产开发', '策划', '工程造价', '物业', '城市规划'] },
  { id: 'energy', name: '能源 / 环保', subs: ['新能源', '电力', '环保', '化工', '双碳'] },
];

// 城市数据：BOSS 风格选择器用（推荐 + 字母索引）
export const CITIES = [
  // 热门/推荐城市
  '北京', '上海', '广州', '深圳', '杭州', '成都', '南京', '武汉', '西安', '苏州',
  '重庆', '天津', '长沙', '郑州', '青岛', '宁波', '东莞', '无锡', '佛山', '合肥',
  '厦门', '福州', '济南', '南昌', '昆明', '沈阳', '大连', '哈尔滨', '长春', '石家庄',
  '贵阳', '南宁', '海口', '兰州', '银川', '西宁', '乌鲁木齐', '拉萨', '呼和浩特', '太原',
  // 其他城市
  '温州', '嘉兴', '绍兴', '金华', '台州', '常州', '南通', '徐州', '扬州', '盐城',
  '淮安', '镇江', '泰州', '昆山', '张家港', '常熟', '江阴', '宜兴', '慈溪', '余姚',
  '芜湖', '蚌埠', '阜阳', '滁州', '六安', '安庆', '马鞍山', '宿州', '亳州', '宣城',
  '洛阳', '南阳', '新乡', '安阳', '焦作', '许昌', '平顶山', '信阳', '商丘', '周口',
  '保定', '唐山', '廊坊', '沧州', '邯郸', '秦皇岛', '邢台', '张家口', '衡水', '承德',
  '烟台', '潍坊', '临沂', '济宁', '淄博', '威海', '泰安', '德州', '聊城', '菏泽',
  '珠海', '汕头', '湛江', '江门', '肇庆', '茂名', '惠州', '梅州', '汕尾', '河源',
  '阳江', '清远', '东莞', '中山', '潮州', '揭阳', '云浮',
  '泉州', '漳州', '莆田', '龙岩', '三明', '南平', '宁德',
  '宁波', '温州', '湖州', '衢州', '舟山', '丽水',
  '合肥', '芜湖', '蚌埠', '淮南', '淮北', '铜陵', '安庆', '黄山', '滁州', '阜阳',
  '宿州', '六安', '亳州', '池州', '宣城',
  '南昌', '赣州', '九江', '宜春', '上饶', '吉安', '抚州', '景德镇', '萍乡', '新余',
  '鹰潭',
  '长沙', '株洲', '湘潭', '衡阳', '邵阳', '岳阳', '常德', '张家界', '益阳', '郴州',
  '永州', '怀化', '娄底', '湘西',
  '南宁', '柳州', '桂林', '梧州', '北海', '防城港', '钦州', '贵港', '玉林', '百色',
  '贺州', '河池', '来宾', '崇左',
  '海口', '三亚', '三沙', '儋州',
  '贵阳', '遵义', '六盘水', '安顺', '毕节', '铜仁', '黔东南', '黔南', '黔西南',
  '成都', '自贡', '攀枝花', '泸州', '德阳', '绵阳', '广元', '遂宁', '内江', '乐山',
  '南充', '眉山', '宜宾', '广安', '达州', '雅安', '巴中', '资阳', '阿坝', '甘孜', '凉山',
  '昆明', '曲靖', '玉溪', '保山', '昭通', '丽江', '普洱', '临沧', '楚雄', '红河',
  '文山', '西双版纳', '大理', '德宏', '怒江', '迪庆',
  '西安', '宝鸡', '咸阳', '铜川', '渭南', '延安', '汉中', '榆林', '安康', '商洛',
  '兰州', '嘉峪关', '金昌', '白银', '天水', '武威', '张掖', '平凉', '酒泉', '庆阳',
  '定西', '陇南', '临夏', '甘南',
  '西宁', '海东', '海北', '黄南', '海南', '果洛', '玉树', '海西',
  '银川', '石嘴山', '吴忠', '固原', '中卫',
  '乌鲁木齐', '克拉玛依', '吐鲁番', '哈密', '昌吉', '博尔塔拉', '巴音郭楞', '阿克苏',
  '克孜勒苏', '喀什', '和田', '伊犁', '塔城', '阿勒泰',
  '拉萨', '日喀则', '昌都', '林芝', '山南', '那曲', '阿里',
  '呼和浩特', '包头', '乌海', '赤峰', '通辽', '鄂尔多斯', '呼伦贝尔', '巴彦淖尔', '乌兰察布',
  '兴安', '锡林郭勒', '阿拉善',
  '沈阳', '大连', '鞍山', '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳',
  '盘锦', '铁岭', '朝阳', '葫芦岛',
  '长春', '吉林', '四平', '辽源', '通化', '白山', '松原', '白城', '延边',
  '哈尔滨', '齐齐哈尔', '鸡西', '鹤岗', '双鸭山', '大庆', '伊春', '佳木斯', '七台河',
  '牡丹江', '黑河', '绥化', '大兴安岭',
];

// 去重并保持顺序
export const UNIQUE_CITIES = [...new Set(CITIES)];

export const DEFAULT_CARD = {
  stage: 'grad',
  goals: ['fulltime'],
  industry: 'ai',
  sub: 'AIGC',
  customIndustry: '', // 自己填写的行业/领域（不区分行业与细分，填写后覆盖预设）
  city: '',
  timePressure: '',
  confusion: '',
  education: '', // 简历提取/手动填写
  resumeExtracted: false,
};

// 把处境卡拼成给后端的 persona 描述（供 alchemy 使用）
export function personaPayload(card) {
  const stage = STAGES.find((x) => x.id === card.stage) || STAGES[0];
  const goals = (card.goals || []).map((g) => (GOALS.find((x) => x.id === g) || {}).name).filter(Boolean);
  const ind = INDUSTRIES.find((x) => x.id === card.industry) || INDUSTRIES[0];
  // 自己填写优先：不区分行业/细分，填了什么就用什么
  const custom = card.customIndustry?.trim();
  const industryName = custom || ind.name;
  const sub = custom || (card.sub || ind.subs[0]);
  const parts = [];
  parts.push(`当前阶段：${stage.name}`);
  if (goals.length) parts.push(`目标：${goals.join('、')}`);
  parts.push(`行业/领域：${custom || `${industryName} / ${sub}`}`);
  if (card.city) parts.push(`目标城市：${card.city}`);
  if (card.timePressure) parts.push(`时间压力：${card.timePressure}`);
  if (card.confusion) parts.push(`当前最困惑：${card.confusion}`);
  if (card.education) parts.push(`背景摘要：${card.education}`);
  const prompt = `你是「${stage.name}」的人，${goals.length ? '想' + goals.join('、') + '，' : ''}所处行业/领域是「${custom || industryName}」，具体方向是「${sub}」。${card.confusion ? '当前最困惑：' + card.confusion + '。' : ''}请围绕这个真实处境去分析，而不是用通用职场建议替代。`;
  return {
    stage: stage.id, stageName: stage.name,
    goals: card.goals || [], goalNames: goals,
    industry: ind.id, industryName,
    sub, subName: sub,
    city: card.city || '', timePressure: card.timePressure || '',
    confusion: card.confusion || '', education: card.education || '',
    prompt,
  };
}

export function personaLabel(card) {
  const stage = STAGES.find((x) => x.id === card.stage) || STAGES[0];
  const ind = INDUSTRIES.find((x) => x.id === card.industry) || INDUSTRIES[0];
  const custom = card.customIndustry?.trim();
  const sub = custom || (card.sub || ind.subs[0]);
  return `${stage.name} · ${custom || ind.name} · ${sub}`;
}

// 基于处境卡生成检索词（模块④：检索词结合处境卡）
// 关键：用户这次输入的问题（confusion）是检索唯一主线，绝不被建档行业（如 AIGC）带偏。
// 之前会把「AIGC AI 找全职」这种建档行业词也塞进检索，导致问"做陶瓷"却搜回一堆 AIGC 结果。
export function buildQueries(card) {
  const stage = STAGES.find((x) => x.id === card.stage) || STAGES[0];
  const goals = (card.goals || []).map((g) => (GOALS.find((x) => x.id === g) || {}).name).filter(Boolean);
  const goalKw = goals[0] || stage.name;
  const out = new Set();
  // 用户这次输入的真实问题是检索绝对主线：排在最前，确保"问什么搜什么"
  if (card.confusion && card.confusion.trim()) {
    const c = card.confusion.trim();
    out.add(c);
    const short = c.replace(/[?？!！。，,、.;；].*$/, '').slice(0, 16) || c.slice(0, 12);
    out.add(short);
    out.add(`${short} ${goalKw}`.trim()); // 同一主题 + 目标，多一个检索角度，但绝不混入建档行业
  }
  // 仅当用户完全没填问题（极少见）时，才退而用建档行业兜底，避免把 AIGC 等建档行业混入检索
  if (out.size === 0) {
    const ind = INDUSTRIES.find((x) => x.id === card.industry) || INDUSTRIES[0];
    const sub = card.sub || ind.subs[0];
    out.add(`${sub} ${goalKw}`.trim());
  }
  return [...out].slice(0, 5);
}

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 取文章第一句话作为梗概
export function brief(summary) {
  if (!summary) return '';
  const t = String(summary).trim();
  const m = t.match(/^[^。！？.!?]{10,120}[。！？.!?]/);
  if (m) return m[0];
  return t.length > 120 ? t.slice(0, 120) + '…' : t;
}

// 标题归一化用于去重：去掉所有空白和标点，避免"标题?-知乎"和"标题？-知乎"被当作两篇
export function normTitle(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

// ---------- 本地存储（历史 + 行动进度） ----------
const HISTORY_KEY = 'alchemy:history';
export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{"topics":[],"sides":{}}'); } catch { return { topics: [], sides: {} }; }
}
export function saveHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {}
}
export function recordTopic(topic) {
  const h = loadHistory();
  h.topics = [topic, ...h.topics.filter((t) => t !== topic)].slice(0, 20);
  saveHistory(h);
}
export function recordSide(side) {
  const h = loadHistory();
  h.sides[side] = (h.sides[side] || 0) + 1;
  saveHistory(h);
}
export function recommendTopics() {
  const h = loadHistory();
  const base = h.topics[0];
  if (!base) return [];
  const variants = [
    `${base}常见误区有哪些`,
    `${base}做到什么程度算及格`,
    `如何判断自己适不适合${base}`,
    `${base}和身边人认知差异怎么破`,
    `新手怎么快速入门${base}`,
  ];
  const seen = new Set(h.topics);
  return variants.filter((v) => !seen.has(v)).slice(0, 3);
}
export function dominantSide() {
  const h = loadHistory();
  const s = h.sides || {};
  const entries = Object.entries(s).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const [topId, topN] = entries[0];
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const map = {
    '刘看山·实干家': '实干家', '刘看山·谋略家': '谋略家', '刘看山·联结者': '联结者',
    r1: '实干家', r2: '谋略家', r3: '联结者',
  };
  return { label: map[topId] || topId, topId, n: topN, total, ratio: total ? topN / total : 0 };
}

export function actKey(d) { return 'alchemy:actions:' + (d.topic || ''); }
export function loadActions(d) {
  try { return JSON.parse(localStorage.getItem(actKey(d)) || '{}'); } catch { return {}; }
}
export function saveActions(d, i, val) {
  const o = loadActions(d); o[i] = val;
  try { localStorage.setItem(actKey(d), JSON.stringify(o)); } catch {}
}

// ---------- 历史炼金包（完整存档，可回看） ----------
// 存的是一整次分析的完整快照（处境卡 + 结果 + 自测），刷新或关掉页面都不丢。
// v 是存档格式版本号：以后改结构时，老存档照样能读出来，不会打不开。
const RECORDS_KEY = 'alchemy:records';
export const RECORD_VERSION = 1;
export const RECORD_MAX = 30;

// 以下两个是纯函数（不碰 localStorage），便于脱离浏览器做回归测试
export function pruneRecords(list, max = RECORD_MAX) {
  const arr = Array.isArray(list) ? list.slice() : [];
  arr.sort((a, b) => (Number(b && b.ts) || 0) - (Number(a && a.ts) || 0)); // 新的排前面
  return arr.slice(0, max);
}
export function normalizeRecord(rec) {
  const r = rec && typeof rec === 'object' ? rec : {};
  return { ...r, v: Number(r.v) || RECORD_VERSION, ts: Number(r.ts) || Date.now() };
}
export function loadRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
    return (Array.isArray(raw) ? raw : []).map(normalizeRecord);
  } catch { return []; }
}
// 自动存档：生成成功就存，同话题覆盖旧的，超过上限淘汰最旧的，不用手动点保存
export function saveRecord({ card, data, quiz }) {
  try {
    const rec = normalizeRecord({
      id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      topic: (data && data.topic) || (card && card.confusion) || '',
      card: card || null,
      data: data || null,
      quiz: quiz || null,
      fallback: !!(data && data.fallback),            // 直答失败、内容由真实搜索结果兜底生成
      lowConfidence: !!(data && data.lowConfidence),  // 相关讨论不足，由相近主题兜底
    });
    const list = [rec, ...loadRecords().filter((r) => r.topic !== rec.topic)];
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(pruneRecords(list, RECORD_MAX)));
    } catch {
      // 本地空间不足：先砍掉一半旧的再试；仍写不进就放弃存档，绝不影响本次生成
      try {
        localStorage.setItem(RECORDS_KEY, JSON.stringify(pruneRecords(list, Math.max(5, Math.floor(RECORD_MAX / 2)))));
      } catch { console.warn('[history] 本地空间不足，本次存档已跳过'); }
    }
    return rec;
  } catch { return null; }
}
// 答完自测后把结果补进「指定的那条」存档（回看历史时答题，结果写回你正在看的那条，不会串档）
export function updateRecordQuiz(id, quiz) {
  try {
    const list = loadRecords();
    const i = list.findIndex((r) => r.id === id);
    if (i < 0 || !quiz) return;
    list[i] = normalizeRecord({ ...list[i], quiz });
    localStorage.setItem(RECORDS_KEY, JSON.stringify(list));
  } catch {}
}

// 导出 Markdown
export function exportMd(d) {
  let md = `# 山外山 · 观山台：${d.topic}\n\n`;
  md += `> 不替你下结论，帮你在知乎众声里炼出自己的判断。由知乎高赞讨论 + 刘看山 AI 炼制。\n\n`;
  md += `## 观点对峙墙\n`;
  md += `> ${d.conflict?.summary || ''}\n\n`;
  (d.conflict?.roles || []).forEach((s) => {
    const srcs = (s.sourceItems || []).map((it) => `- [${it.title}](${it.url})` + (it.author ? ` — ${it.author}` : '')).join('\n  ');
    md += `**${s.stance}**\n- 最强论点：${s.coreArg}\n- 适合谁：${s.bestFor}\n- 边界：${s.boundary}\n- 来源文章：\n  ${srcs || (s.source || '（演示模式）')}\n\n`;
  });
  md += `## 信谁框架\n`;
  (d.framework?.dimensions || []).forEach((x) => { md += `- **${x.dim}**：${x.guide}\n`; });
  md += `\n## 判断力自测\n`;
  (d.quiz || []).forEach((q, i) => {
    md += `${i + 1}. ${q.scenario}\n   - 你的立场：${q.prompt}\n   - 反馈：${q.feedback}\n`;
  });
  md += `\n## 行动地图\n`;
  (d.actions || []).forEach((a) => { md += `- [ ] ${a.task} —— ${a.why}\n`; });
  md += `\n## 知乎来源\n`;
  (d.sources || []).forEach((s) => { md += `- [${s.title}](${s.url}) — ${s.author || ''}\n`; });
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `山外山_${d.topic}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 把一条历史炼金包压成纯文本，作为知识库 / RAG 的上下文素材（轻量，不依赖向量库）
export function recordToText(rec) {
  const d = rec?.data || {};
  const parts = [];
  parts.push('主题：' + (rec?.topic || d.topic || '未命名'));
  const roles = d.conflict?.roles || [];
  if (roles.length) {
    parts.push('观点对峙：');
    roles.forEach((r) => {
      const name = r.name || r.stance || '某角色';
      const arg = r.coreArg || '';
      if (arg) parts.push(`- ${name}：${arg}`);
    });
  }
  const acts = d.actions || [];
  if (acts.length) {
    parts.push('行动地图：');
    acts.forEach((a) => { if (a.task) parts.push(`- ${a.task}`); });
  }
  return parts.join('\n');
}
