const $ = (s) => document.querySelector(s);
const input = $('#input');
const form = $('#form');
const submitBtn = $('#submitBtn');
const loading = $('#loading');
const result = $('#result');
const exportBtn = $('#exportBtn');
const printBtn = $('#printBtn');

let currentMode = 'newgrad';
let currentData = null;

// 用户画像配置（身份 + 行业 + 细分领域）
const PERSONAS = {
  identities: [
    { id: 'pre', name: '准入行' },
    { id: 'deepen', name: '在职深耕' },
    { id: 'shift', name: '在职转型' },
  ],
  industries: [
    { id: 'ai', name: 'AI', subs: ['算法', 'Agent', 'AIGC', 'AI 产品', '模型训练', '数据标注'] },
    { id: 'live', name: '直播', subs: ['直播运营', '主播', '直播助理', '场控', '选品', '投流'] },
    { id: 'finance', name: '金融', subs: ['投行', '量化', '风控', '财富管理', '行研', '保险'] },
    { id: 'media', name: '传媒', subs: ['内容运营', '编导', '媒介', '公关', '短视频', '品牌'] },
    { id: 'it', name: 'IT', subs: ['前端', '后端', '产品', '测试', '运维', '数据'] },
    { id: 'hr', name: 'HR', subs: ['招聘', 'OD', '薪酬绩效', 'HRBP', '培训', '员工关系'] },
    { id: 'sport', name: '运动', subs: ['教练', '赛事运营', '运动康复', '体能', '场馆', '青训'] },
    { id: 'logistics', name: '物流', subs: ['供应链', '仓储', '运力', '跨境物流', '冷链', '仓配'] },
  ],
  default: { identity: 'pre', industry: 'ai', sub: 'AIGC' },
};

// 当前 persona（id 组合），并生成喂给后端的画像文本
let currentPersona = { ...PERSONAS.default };
function personaPayload() {
  const id = PERSONAS.identities.find((x) => x.id === currentPersona.identity) || PERSONAS.identities[0];
  const ind = PERSONAS.industries.find((x) => x.id === currentPersona.industry) || PERSONAS.industries[0];
  const sub = currentPersona.sub || ind.subs[0];
  return {
    identity: id.id, identityName: id.name,
    industry: ind.id, industryName: ind.name,
    sub: sub, subName: sub,
    prompt: `你是「${id.name}」的人，所处行业是「${ind.name}」，具体细分领域是「${sub}」。请围绕这个真实身份去分析，而不是用通用职场建议替代。`,
  };
}
function personaLabel() {
  const id = PERSONAS.identities.find((x) => x.id === currentPersona.identity) || PERSONAS.identities[0];
  const ind = PERSONAS.industries.find((x) => x.id === currentPersona.industry) || PERSONAS.industries[0];
  return `${id.name} · ${ind.name} · ${currentPersona.sub || ind.subs[0]}`;
}

// 画像选择器（左侧身份 + 右侧行业/细分）
function buildPersonaPicker() {
  const host = $('#personaPicker');
  if (!host) return;
  host.innerHTML = '';
  // 身份（左侧一列）
  const idBox = document.createElement('div');
  idBox.className = 'pp-idcol';
  idBox.innerHTML = '<div class="pp-label">你的身份</div>';
  PERSONAS.identities.forEach((id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pp-id' + (id.id === currentPersona.identity ? ' active' : '');
    b.textContent = id.name;
    b.onclick = () => { currentPersona.identity = id.id; rerenderPicker(); onPersonaChange(); };
    idBox.appendChild(b);
  });
  host.appendChild(idBox);
  // 行业（右侧）
  const indBox = document.createElement('div');
  indBox.className = 'pp-indcol';
  PERSONAS.industries.forEach((ind) => {
    const item = document.createElement('div');
    item.className = 'pp-ind' + (ind.id === currentPersona.industry ? ' active' : '');
    const title = document.createElement('div');
    title.className = 'pp-ind-title';
    title.textContent = ind.name;
    item.appendChild(title);
    const subs = document.createElement('div');
    subs.className = 'pp-subs';
    ind.subs.forEach((s) => {
      const sb = document.createElement('span');
      sb.className = 'pp-sub' + (ind.id === currentPersona.industry && s === currentPersona.sub ? ' active' : '');
      sb.textContent = s;
      sb.onclick = (e) => { e.stopPropagation(); currentPersona.industry = ind.id; currentPersona.sub = s; rerenderPicker(); onPersonaChange(); };
      subs.appendChild(sb);
    });
    item.appendChild(subs);
    item.onclick = () => { currentPersona.industry = ind.id; currentPersona.sub = ind.subs[0]; rerenderPicker(); onPersonaChange(); };
    indBox.appendChild(item);
  });
  host.appendChild(indBox);
}
function rerenderPicker() { buildPersonaPicker(); buildMegaMenu(); }

// 顶部导航「筛选」mega menu：复用同一套数据，渲染到顶部下拉
function buildMegaMenu() {
  const host = $('#megaMenu');
  if (!host) return;
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'mega-inner';
  // 左列：身份
  const idCol = document.createElement('div');
  idCol.className = 'mega-idcol';
  idCol.innerHTML = '<div class="pp-label">你的身份</div>';
  PERSONAS.identities.forEach((id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pp-id' + (id.id === currentPersona.identity ? ' active' : '');
    b.textContent = id.name;
    b.onclick = () => { currentPersona.identity = id.id; rerenderPicker(); onPersonaChange(); };
    idCol.appendChild(b);
  });
  wrap.appendChild(idCol);
  // 右列：行业 + 细分
  const indCol = document.createElement('div');
  indCol.className = 'mega-indcol';
  PERSONAS.industries.forEach((ind) => {
    const item = document.createElement('div');
    item.className = 'pp-ind' + (ind.id === currentPersona.industry ? ' active' : '');
    const title = document.createElement('div');
    title.className = 'pp-ind-title';
    title.textContent = ind.name;
    item.appendChild(title);
    const subs = document.createElement('div');
    subs.className = 'pp-subs';
    ind.subs.forEach((s) => {
      const sb = document.createElement('span');
      sb.className = 'pp-sub' + (ind.id === currentPersona.industry && s === currentPersona.sub ? ' active' : '');
      sb.textContent = s;
      sb.onclick = (e) => { e.stopPropagation(); currentPersona.industry = ind.id; currentPersona.sub = s; rerenderPicker(); onPersonaChange(); };
      subs.appendChild(sb);
    });
    item.appendChild(subs);
    item.onclick = () => { currentPersona.industry = ind.id; currentPersona.sub = ind.subs[0]; rerenderPicker(); onPersonaChange(); };
    indCol.appendChild(item);
  });
  wrap.appendChild(indCol);
  host.appendChild(wrap);
}

// mega menu 展开/收起（hover + 点击）
function initMega() {
  const nav = $('#filterNav');
  const tab = $('#filterTab');
  if (!nav || !tab) return;
  let timer = null;
  const open = () => { clearTimeout(timer); nav.classList.add('open'); };
  const close = () => { timer = setTimeout(() => nav.classList.remove('open'), 180); };
  nav.addEventListener('mouseenter', open);
  nav.addEventListener('mouseleave', close);
  tab.addEventListener('click', (e) => { e.stopPropagation(); nav.classList.toggle('open'); });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) nav.classList.remove('open'); });
}
// 画像变化：有结果则自动用新画像重炼（避免上下不一致）
function onPersonaChange() {
  loadRecommend(); // 选好职业后，自动推送该职业相关的真实知乎内容
  if (currentData && currentData.topic && loading.classList.contains('hidden')) {
    run(currentData.topic);
  }
}

// 按「身份 + 行业 + 细分」生成该职业的推荐搜索词（调用真实知乎搜索）
function recommendQueries() {
  const id = PERSONAS.identities.find((x) => x.id === currentPersona.identity) || PERSONAS.identities[0];
  const ind = PERSONAS.industries.find((x) => x.id === currentPersona.industry) || PERSONAS.industries[0];
  const sub = currentPersona.sub || ind.subs[0];
  const seed = sub || ind.name;
  // 身份前缀让推荐更贴合用户阶段
  const idPrefix = { pre: '校招', deepen: '在职', shift: '转行' }[id.id] || '';
  return [
    `${seed} ${idPrefix}`.trim(),
    `${seed} 工作体验`,
    `${seed} 真实收入`,
    `${seed} 发展前景`,
    `${ind.name} ${sub} 面试`,
  ].filter((q, i, a) => a.indexOf(q) === i); // 去重
}

// 实时拉取真实知乎内容，渲染「为你推荐」卡片流
async function loadRecommend() {
  const box = $('#recCards');
  const titleEl = $('#recTitle');
  const subEl = $('#recSub');
  const liveEl = $('#recLive');
  if (!box) return;
  const label = personaLabel();
  titleEl.textContent = '为你推荐';
  subEl.textContent = label;
  liveEl.textContent = '真实知乎';
  box.innerHTML = '<span class="rec-empty">正在拉取真实知乎内容…</span>';
  const queries = recommendQueries();
  try {
    // 并发拉取多个职业相关词的真实搜索结果
    const results = await Promise.all(queries.map((q) =>
      fetch('/api/search?q=' + encodeURIComponent(q))
        .then((r) => r.json())
        .then((d) => ({ q, items: (d.items || []).filter((it) => !it.title?.includes('（演示')) }))
        .catch(() => ({ q, items: [] }))
    ));
    // 去重（按标题），最多 12 条
    const seen = new Set();
    const cards = [];
    results.forEach(({ q, items }) => {
      items.forEach((it) => {
        const key = (it.title || '').slice(0, 30);
        if (seen.has(key)) return;
        seen.add(key);
        cards.push({ ...it, q });
      });
    });
    if (!cards.length) {
      box.innerHTML = '<span class="rec-empty">暂未拉到相关真实内容，换一个细分领域试试～</span>';
      return;
    }
    box.innerHTML = '';
    cards.slice(0, 12).forEach((it) => {
      const el = document.createElement('a');
      el.className = 'rec-card';
      el.href = it.url || '#';
      el.target = '_blank';
      el.rel = 'noopener';
      el.innerHTML =
        `<div class="rec-card-q">${esc(it.q)}</div>` +
        `<div class="rec-card-title">${esc(it.title || '')}</div>` +
        (it.summary ? `<div class="rec-card-sum">${esc(it.summary.slice(0, 60))}…</div>` : '') +
        `<div class="rec-card-meta">${esc(it.author || '知乎')}${it.voteUp ? ' · 👍' + it.voteUp : ''} · 炼这个 →</div>`;
      // 点击「炼这个」直接进炼金（阻止跳外链，改为本地炼）
      el.onclick = (e) => {
        if (it.title) { e.preventDefault(); input.value = it.title; run(it.title); }
      };
      box.appendChild(el);
    });
  } catch (e) {
    box.innerHTML = '<span class="rec-empty">推荐拉取失败，请刷新重试。</span>';
  }
}

// 模式徽标
async function loadHealth() {
  try {
    const r = await fetch('/api/health');
    const d = await r.json();
    const badge = $('#modeBadge');
    if (d.mode === 'live') {
      badge.textContent = 'LIVE · 已接入知乎';
      badge.className = 'badge badge-live';
    } else {
      badge.textContent = '演示模式 · 配置 Secret 后接真实数据';
      badge.className = 'badge badge-demo';
    }
  } catch {}
}

// 热榜快捷：任何话题都用"当前画像"去炼（画像让任意话题都有行业意义）
async function loadHot() {
  try {
    const r = await fetch('/api/hot');
    const d = await r.json();
    const box = $('#hotChips');
    box.innerHTML = '';
    (d.items || []).slice(0, 8).forEach((it) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = it.title;
      c.title = '用当前画像（' + personaLabel() + '）炼这个话题';
      c.onclick = () => { input.value = it.title; run(it.title); };
      box.appendChild(c);
    });
  } catch {}
}

async function run(q) {
  q = (q || input.value || '').trim();
  if (!q) return;
  input.value = q;
  recordTopic(q);
  loading.classList.remove('hidden');
  result.classList.add('hidden');
  submitBtn.disabled = true;
  try {
    const pp = personaPayload();
    const r = await fetch('/api/alchemy?q=' + encodeURIComponent(q)
      + '&persona=' + encodeURIComponent(JSON.stringify(pp)));
    const d = await r.json();
    if (d.error) {
      showError('后端出错了：' + d.error + '（已尝试返回本地演示数据，请刷新重试）');
      return;
    }
    currentData = d;
    render(d);
  } catch (e) {
    showError('服务连接失败，请刷新页面或稍后重试。');
  } finally {
    loading.classList.add('hidden');
    submitBtn.disabled = false;
  }
}

function showError(msg) {
  result.classList.remove('hidden');
  $('#resultTopic').textContent = '';
  $('#conflictSummary').textContent = '';
  $('#sides').innerHTML = '';
  $('#framework').innerHTML = '';
  $('#quiz').innerHTML = '';
  $('#actions').innerHTML = '';
  $('#sources').innerHTML = '';
  let box = $('#errorBox');
  if (!box) { box = document.createElement('div'); box.id = 'errorBox'; box.className = 'error-box'; result.prepend(box); }
  box.textContent = '⚠️ ' + msg;
}

function render(d) {
  const label = personaLabel();
  $('#resultTopic').textContent = '关于「' + (d.topic || '') + '」的炼金结果 · ' + label;

  // fallback 提示（LIVE 下直答失败但用本地演示数据兜底时）
  let fb = $('#fallbackBanner');
  if (d.fallback) {
    if (!fb) { fb = document.createElement('div'); fb.id = 'fallbackBanner'; fb.className = 'fallback-banner'; result.prepend(fb); }
    fb.textContent = '⚡ 当前为演示数据：知乎直答响应较慢，已自动切换本地生成的刘看山辩论内容，来源仍可点击。';
  } else if (fb) {
    fb.remove();
  }

  // 1. 多角色观点对照墙
  $('#conflictSummary').textContent = d.conflict?.summary || '';
  const sides = $('#sides');
  sides.innerHTML = '';
  const roleMap = {};
  (d.conflict?.roles || []).forEach((s, i) => { roleMap[s.id] = s; });
  (d.conflict?.roles || []).forEach((s, i) => {
    let rebuts = '';
    (s.rebuts || []).forEach((rb) => {
      const to = roleMap[rb.to]?.name || rb.to;
      rebuts += `<div class="rebut"><span class="rebut-to">⤷ 质疑 ${esc(to)}：</span>${esc(rb.text)}</div>`;
    });
    const srcItems = s.sourceItems || [];
    // 只保留蓝字标题 + 一句内容梗概（取文章第一句话或生成短摘要）
    function brief(summary, title) {
      if (!summary) return '';
      const t = String(summary).trim();
      const m = t.match(/^[^。！？.!?]{10,120}[。！？.!?]/);
      if (m) return m[0];
      return t.length > 120 ? t.slice(0, 120) + '…' : t;
    }
    const backItems = srcItems.length
      ? srcItems.map((it) => `
        <li class="src-item">
          <a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
          ${it.summary ? `<div class="src-sum">${esc(brief(it.summary, it.title))}</div>` : ''}
        </li>`).join('')
      : '<li class="muted">（演示模式：配置 Secret 后展示真实知乎文章来源）</li>';
    const el = document.createElement('div');
    el.className = 'role role-' + (i % 3);
    el.innerHTML =
      `<div class="face front">
        <div class="role-head"><span class="role-ava">${esc(s.avatar || (s.name || '山')[0])}</span>` +
        `<div><div class="role-name">${esc(s.name)}</div>${s.form ? `<div class="role-form">${esc(s.form)}</div>` : ''}<div class="role-persona">${esc(s.persona || '')}</div></div>` +
        `<span class="flip-hint" title="查看 ${esc(s.name)} 的 ${srcItems.length} 篇来源" aria-label="翻面"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 6a2 2 0 0 1 2 2v5a2 2 0 0 1-4 0V8a2 2 0 0 1 2-2Zm7 5a7 7 0 0 1-6 6.9V20h-2v-2.1A7 7 0 0 1 5 11h2a5 5 0 0 0 10 0h2Z"/></svg></span></div>` +
        `<div class="role-debate">刘看山的三种样子正在辩论</div>` +
        `<div class="role-stance">${esc(s.stance)}</div>` +
        `<div class="side-arg"><span class="lbl">最强论点</span>${esc(s.coreArg)}</div>` +
        `<div class="side-row"><span class="lbl">适合谁</span>${esc(s.bestFor)}</div>` +
        `<div class="side-row"><span class="lbl">边界</span>${esc(s.boundary)}</div>` +
        (rebuts ? `<div class="rebuts">${rebuts}</div>` : '') +
      `</div>
      <div class="face back">
        <div class="back-title"><span class="flip-hint" title="返回论点" aria-label="返回">↩</span> ${esc(s.name)} 的论点依据</div>
        <ul class="src-list">${backItems}</ul>
      </div>`;
    el.onclick = (e) => { if (e.target.closest('a')) return; el.classList.toggle('flipped'); };
    sides.appendChild(el);
  });

  // 2. 信谁框架
  const fw = $('#framework');
  fw.innerHTML = '';
  renderTendencyBanner();
  if (d.framework?.title) {
    const t = document.createElement('div');
    t.className = 'fw-title';
    t.textContent = d.framework.title;
    fw.appendChild(t);
  }
  const grid = document.createElement('div');
  grid.className = 'fw-grid';
  (d.framework?.dimensions || []).forEach((x) => {
    const el = document.createElement('div');
    el.className = 'fw-card';
    el.innerHTML = `<div class="fw-dim">${esc(x.dim)}</div><div class="fw-guide">${esc(x.guide)}</div>`;
    grid.appendChild(el);
  });
  fw.appendChild(grid);

  // 3. 判断力自测（交互：选立场 + 写理由 + 看反馈）
  const quiz = $('#quiz');
  quiz.innerHTML = '';
  (d.quiz || []).forEach((q, qi) => {
    const el = document.createElement('div');
    el.className = 'q-item';
    let opts = '';
    (q.options || []).forEach((o, oi) => {
      opts += `<label class="q-opt"><input type="radio" name="q${qi}" value="${oi}" /> ${esc(o.label)} <span class="q-side">（${esc(o.side || '')}）</span></label>`;
    });
    el.innerHTML =
      `<div class="q-scenario">${esc(q.scenario)}</div>` +
      `<div class="q-opts">${opts || '<span class="muted">（本题无选项，请直接写下你的立场）</span>'}</div>` +
      `<textarea class="q-reason" placeholder="${esc(q.prompt || '写下你的理由…')}"></textarea>` +
      `<button type="button" class="q-btn">看看反馈 ▾</button>` +
      `<div class="q-feedback hidden">${esc(q.feedback)}</div>`;
    const btn = el.querySelector('.q-btn');
    btn.onclick = () => {
      const open = el.querySelector('.q-feedback').classList.toggle('hidden');
      btn.textContent = open ? '收起反馈 ▴' : '看看反馈 ▾';
      if (open) {
        // 记录用户选择倾向（取该题被选中 radio 对应的角色）
        const checked = el.querySelector('input[type=radio]:checked');
        if (checked) {
          const side = checked.value && q.options[Number(checked.value)]?.side;
          if (side) recordSide(side);
        }
        smoothScroll(el.querySelector('.q-feedback'));
      }
    };
    quiz.appendChild(el);
  });

  // 4. 行动地图（可勾选 + localStorage 进度）
  const actions = $('#actions');
  actions.innerHTML = '';
  const saved = loadActions(d);
  (d.actions || []).forEach((a, ai) => {
    const el = document.createElement('label');
    el.className = 'act' + (saved[ai] ? ' done' : '');
    el.innerHTML =
      `<input type="checkbox" ${saved[ai] ? 'checked' : ''} />` +
      `<div class="act-body"><div class="act-task">${esc(a.task)}</div><div class="act-why">${esc(a.why)}</div></div>`;
    const cb = el.querySelector('input');
    cb.onchange = () => {
      el.classList.toggle('done', cb.checked);
      saveActions(d, ai, cb.checked);
    };
    actions.appendChild(el);
  });

  // 来源
  const sources = $('#sources');
  sources.innerHTML = '';
  (d.sources || []).forEach((s) => {
    const li = document.createElement('li');
    const auth = s.authority ? ` · 权威${s.authority}级` : '';
    const vote = s.voteUp ? ` · 👍${s.voteUp}` : '';
    li.innerHTML = `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` +
      `<div class="meta">${esc(s.author || '')}${auth}${vote}</div>`;
    sources.appendChild(li);
  });

  result.classList.remove('hidden');
  smoothScroll(result);
}

// 行动清单本地存储（按 话题+模式 记忆勾选进度）
function actKey(d) { return 'alchemy:actions:' + (d.topic || ''); }
function loadActions(d) {
  try { return JSON.parse(localStorage.getItem(actKey(d)) || '{}'); } catch { return {}; }
}
function saveActions(d, i, val) {
  const o = loadActions(d); o[i] = val;
  try { localStorage.setItem(actKey(d), JSON.stringify(o)); } catch {}
}

// ---------- 板块1：软件内使用历史（本地存储，不依赖知乎私有数据） ----------
const HISTORY_KEY = 'alchemy:history';
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{"topics":[],"sides":{}}'); } catch { return { topics: [], sides: {} }; }
}
function saveHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {}
}
// 记录一次搜索话题（去重，最多保留 20 条，最新在前）
function recordTopic(topic) {
  const h = loadHistory();
  h.topics = [topic, ...h.topics.filter((t) => t !== topic)].slice(0, 20);
  saveHistory(h);
  renderRecommend();
}
// 记录一次自测选项（side 为角色名或 id）
function recordSide(side) {
  const h = loadHistory();
  h.sides[side] = (h.sides[side] || 0) + 1;
  saveHistory(h);
}

// 基于历史话题，用本地规则生成"相关但角度不同"的推荐（零知乎额度消耗）
function recommendTopics() {
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
  // 过滤掉已经搜过的
  const seen = new Set(h.topics);
  return variants.filter((v) => !seen.has(v)).slice(0, 3);
}

// 根据自测历史算出用户最偏好的刘看山形态
function dominantSide() {
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
  return { label: map[topId] || topId, n: topN, total, ratio: total ? topN / total : 0 };
}

// 导出 Markdown（可分享 / 攒人气）
function exportMd(d) {
  let md = `# 知乎炼金术 · 判断力炼金包：${d.topic}\n\n`;
  md += `> 不替你下结论，帮你在知乎众声里炼出自己的判断。由知乎高赞讨论 + 刘看山 AI 炼制。\n\n`;
  md += `## ⚔️ 观点对峙墙\n`;
  md += `> ${d.conflict?.summary || ''}\n\n`;
  (d.conflict?.roles || []).forEach((s) => {
    const srcs = (s.sourceItems || []).map((it) => `- [${it.title}](${it.url})` + (it.author ? ` — ${it.author}` : '')).join('\n  ');
    md += `**${s.stance}**\n- 最强论点：${s.coreArg}\n- 适合谁：${s.bestFor}\n- 边界：${s.boundary}\n- 来源文章：\n  ${srcs || (s.source || '（演示模式）')}\n\n`;
  });
  md += `## 🧭 信谁框架\n`;
  (d.framework?.dimensions || []).forEach((x) => { md += `- **${x.dim}**：${x.guide}\n`; });
  md += `\n## 🎯 判断力自测\n`;
  (d.quiz || []).forEach((q, i) => {
    md += `${i + 1}. ${q.scenario}\n   - 你的立场：${q.prompt}\n   - 反馈：${q.feedback}\n`;
  });
  md += `\n## 🚶 行动地图\n`;
  (d.actions || []).forEach((a) => { md += `- [ ] ${a.task} —— ${a.why}\n`; });
  md += `\n## 📚 知乎来源\n`;
  (d.sources || []).forEach((s) => { md += `- [${s.title}](${s.url}) — ${s.author || ''}\n`; });
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `知乎炼金术_${d.topic}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 安全滚动：元素存在才滚，避免 WebView 对 null 调 scrollIntoView 报 getBoundingClientRect
function smoothScroll(el) {
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// 首页"为你推荐"：基于历史搜索话题生成相关推荐（纯本地，零额度）
function renderRecommend() {
  const box = $('#recChips');
  if (!box) return;
  const recs = recommendTopics();
  const h = loadHistory();
  if (!h.topics.length) {
    box.innerHTML = '<span class="rec-empty">搜几个话题后，这里会根据你的兴趣推荐相关角度 👀</span>';
    return;
  }
  if (!recs.length) {
    box.innerHTML = '<span class="rec-empty">你已探索过这些方向，换个词试试更多角度～</span>';
    return;
  }
  box.innerHTML = '';
  recs.forEach((v) => {
    const c = document.createElement('span');
    c.className = 'chip rec';
    c.textContent = '🔁 ' + v;
    c.onclick = () => { input.value = v; run(v); };
    box.appendChild(c);
  });
}

// 信谁框架顶部：基于自测历史提示用户的刘看山倾向
function renderTendencyBanner() {
  const host = $('#tendencyHost');
  if (!host) return;
  const dom = dominantSide();
  if (!dom) { host.innerHTML = ''; return; }
  const pct = Math.round(dom.ratio * 100);
  host.innerHTML = `<div class="tendency">🧭 <strong>你的历史倾向：刘看山·${esc(dom.label)}</strong>` +
    `（过去 ${dom.total} 次自测中 ${dom.n} 次选择这一派，占比 ${pct}%）` +
    `——信谁框架提醒你：越偏爱的视角越要主动补另外两种，避免单一心智模型。</div>`;
}

form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
exportBtn.onclick = () => { if (currentData) exportMd(currentData); };
printBtn.onclick = () => window.print();

// 打开即完整：自动跑一个示例话题（默认画像 准入行·AI·AIGC）
buildMegaMenu();
initMega();
loadHealth();
loadHot();
renderRecommend();
loadRecommend(); // 首屏即拉取真实知乎推荐（按默认职业筛选）
run('第一份工作选大厂还是创业');

// 板块2：连接知乎账号（OAuth）→ 基于关注/粉丝的信息宇宙分析
const oauthBtn = $('#oauthBtn');
function showOAuthResult(data) {
  const block = $('#oauthBlock');
  const out = $('#oauthResult');
  block.classList.remove('hidden');
  const u = data.user || {};
  out.innerHTML = `
    <div class="oauth-card">
      <div class="oauth-name">👤 ${esc(u.name || '知乎用户')}</div>
      <p class="oauth-note">${esc(u.note || '已连接成功，基于你的关注/粉丝关系，我们可生成专属的「信息宇宙」图谱与偏好总结。')}</p>
      ${data.mock ? '<span class="oauth-mock">当前为 MOCK 模式（本地演示）：部署到公网并配置真实 app_id/app_key 后，将读取真实关注/粉丝数据。</span>' : ''}
    </div>`;
  smoothScroll(block);
}
oauthBtn.onclick = () => {
  oauthBtn.disabled = true;
  oauthBtn.textContent = '连接中…';
  const w = window.open('/api/oauth/login', 'zhihu_oauth', 'width=600,height=600,popup=1');
  if (!w) {
    showError('连接知乎账号失败：请允许弹出窗口');
    oauthBtn.disabled = false;
    oauthBtn.textContent = '🔗 连接知乎账号';
    return;
  }
  const onMsg = (e) => {
    if (e.data?.type !== 'zhihu-oauth') return;
    window.removeEventListener('message', onMsg);
    const data = e.data?.payload || {};
    if (data.error) showError('连接知乎账号失败：' + data.error);
    else showOAuthResult(data);
    oauthBtn.disabled = false;
    oauthBtn.textContent = '🔗 连接知乎账号';
  };
  window.addEventListener('message', onMsg);
  // 弹窗被手动关闭后兜底恢复按钮
  const t = setInterval(() => {
    if (w.closed) { clearInterval(t); window.removeEventListener('message', onMsg); oauthBtn.disabled = false; oauthBtn.textContent = '🔗 连接知乎账号'; }
  }, 500);
};
