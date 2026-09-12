import React, { useState } from 'react';
import { esc, brief, normTitle, personaLabel, loadRoad, saveRoad } from '../lib.js';

// 山头调色板：每个观点角色对应一条固定的山色，贯穿观点墙→自测→行动地图
const HILL = ['#2f6fa8', '#4c7a5a', '#8a6a3a', '#7c5cb0', '#0e7490'];

// 后端偶尔会把 boundary 写成"代表个人观点"这类空话，前端兜底反向生成一条具体边界
function cleanBoundary(s) {
  const b = String(s.boundary || '').trim();
  if (!b || /代表.?个人观点|结合.?自己处境|仅供参考|请.?自行判断/.test(b)) {
    const core = (s.coreArg || s.stance || '').slice(0, 50);
    const fit = (s.bestFor || '').slice(0, 40);
    return `它认为"${core}…"这个结论成立的前提是：你的处境和"${fit || '该角色假设的背景'}"高度重合。`;
  }
  return b;
}

// 后端没给 rebuts 时，自动从 boundary+另一角色的 coreArg 生成一条交锋，避免"暂无交锋"空白
function makeFallbackRebut(s, roles) {
  if (Array.isArray(s.rebuts) && s.rebuts.length) return s.rebuts;
  const others = roles.filter((r) => r.id !== s.id);
  const target = others[0];
  if (!target) return [];
  const selfPre = cleanBoundary(s).replace(/^.*?: /, '').slice(0, 60);
  const targetArg = (target.coreArg || target.stance || target.name || '').slice(0, 60);
  return [{
    to: target.id,
    text: `如果"${selfPre}…"不成立，那 ${target.name || target.stance} 的质疑就成立：${targetArg}。`,
  }];
}

function cleanSourceTitle(t) {
  let s = String(t || '').trim();
  if (!s) return '相关讨论';
  s = s.replace(/\s*[-—–]\s*(知乎|知乎网|Zhihu|zhihu)\s*$/i, ''); // 去掉 " - 知乎" 尾巴
  s = s.replace(/[|｜]\s*《?[^》]*》?\s*$/, ''); // 去掉末尾 " | 《xxx》" 这类 SEO 尾巴
  if (s.length > 36) s = s.slice(0, 36) + '…';
  return s;
}

function sourceKind(item) {
  if (item?.demo || item?.source === 'demo') return 'demo';
  if (item?.source === 'web') return 'web';
  try {
    if (/(^|\.)zhihu\.com$/i.test(new URL(item?.url || '').hostname)) return 'zhihu';
  } catch {}
  return item?.url ? 'web' : 'unknown';
}

function roleSourceLabel(role, demo) {
  if (demo) return '演示素材';
  const first = (role?.sourceItems || []).find((item) => sourceKind(item) !== 'demo' && item?.url);
  if (!first) return '暂无可核验原文';
  return first.author || (sourceKind(first) === 'zhihu' ? '知乎原文' : '全网原文');
}

function SourceCard({ item, demo = false }) {
  const [flip, setFlip] = useState(false);
  // 全网结果没有点赞数据（网页不点赞），它按权威等级参与排序；这里把来源与可信度标出来，让"信谁"有依据
  const kind = sourceKind(item);
  const isWeb = kind === 'web';
  const isDemo = demo || kind === 'demo';
  const parts = [];
  if (item.author) parts.push(item.author);
  if (!isDemo && item.voteUp) parts.push(`${item.voteUp} 赞`);
  const meta = parts.join(' · ');
  const title = cleanSourceTitle(item.title);
  function toggleFlip() { setFlip((f) => !f); }
  function onKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFlip(); }
  }
  return (
    <div
      className={`source-card${flip ? ' flipped' : ''}${isWeb ? ' web' : ''}${isDemo ? ' demo' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={flip}
      aria-label={`${title}，${flip ? '收起摘要' : '查看摘要'}`}
      onClick={toggleFlip}
      onKeyDown={onKeyDown}
    >
      <div className="source-front">
        <div className="source-title">{esc(title)}</div>
        <div className="source-badges">
          <span className={`src-badge ${isDemo ? 'demo' : (isWeb ? 'web' : 'zhihu')}`}>{isDemo ? '演示' : (isWeb ? '全网' : '知乎')}</span>
          {!isDemo && item.authority ? <span className="src-badge auth">分量 {esc(String(item.authority))} 级</span> : null}
        </div>
        <div className="source-meta">{esc(meta || '翻面看梗概')}</div>
      </div>
      <div className="source-back">
        <div className="source-brief">{esc(brief(item.summary))}</div>
        {isDemo || !item.url
          ? <span className="source-link source-link-disabled">演示素材，不打开外部原文</span>
          : <a href={item.url} target="_blank" rel="noreferrer" className="source-link" onClick={(e) => e.stopPropagation()}>{isWeb ? '打开原文 →' : '打开知乎原文 →'}</a>}
      </div>
    </div>
  );
}

function RebutItem({ r, roles }) {
  // 兼容两种字段写法：新 {to, text} 与旧存档 {target, quote}
  const to = typeof r === 'string' ? '' : (r.to || r.target || '');
  const target = to ? roles.find((x) => x.id === to) : null;
  const text = typeof r === 'string' ? r : (r.text || r.quote || '');
  // 如果角色名带「·」，只显示派系前缀，避免 target 名长得像文章标题、和来源卡片视觉重复
  const targetFull = target?.name || target?.stance || to;
  const targetShort = (target?.name?.split('·')[0]?.trim()) || target?.name || target?.stance || to;
  return (
    <div className="rebut-item">
      <span className="rebut-arrow">→</span>
      <span>{esc(text)}{target && <span className="rebut-target" title={esc(targetFull)}>（针对 {esc(targetShort)}）</span>}</span>
    </div>
  );
}

// 长文默认只给前 max 字，避免整篇原文直接拍在用户脸上
function LongText({ text, max = 120 }) {
  const [open, setOpen] = useState(false);
  const t = String(text || '');
  if (t.length <= max) return <>{esc(t)}</>;
  return (
    <span className="long-text">
      {open ? esc(t) : `${esc(t.slice(0, max))}…`}
      <button
        type="button"
        className="link-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >{open ? '收起' : '展开全文'}</button>
    </span>
  );
}

function PreviewLine({ s, i }) {
  const core = s.coreArg || s.stance || '';
  const short = core.length > 70 ? `${esc(core.slice(0, 70))}…` : esc(core);
  const items = s.sourceItems || [];
  const allDemo = items.length > 0 && items.every((it) => sourceKind(it) === 'demo');
  const zh = items.filter((it) => sourceKind(it) === 'zhihu').length;
  const web = items.filter((it) => sourceKind(it) === 'web').length;
  return (
    <div className="role-preview">
      <span className="role-preview-core">{short}</span>
      <span className="role-preview-meta">
        {items.length ? (allDemo ? `演示素材 ${items.length} 条 · ` : `来源 ${items.length} 条（知乎 ${zh} · 全网 ${web}） · `) : ''}适合 {esc((s.bestFor || '').slice(0, 24) || '…')}
      </span>
    </div>
  );
}

export default function ConflictWall({ conflict, persona, onNext, demo = false, sourceStats, roadData = null }) {
  const [openIdx, setOpenIdx] = useState(() => conflict?.roles?.length ? 0 : null);
  const [taskStarted, setTaskStarted] = useState(() => Boolean(roadData && loadRoad(roadData)?.__current?.started));
  if (!conflict) return null;

  const firstRole = conflict.roles?.[0];
  const fallbackTask = {
    verify: `先验证“${(firstRole?.stance || conflict.topic || '这条观点').slice(0, 54)}”是否真的适合你的处境。`,
    input: persona?.confusion ? '你的当前困惑，加上 1 个真实岗位或具体机会。' : '1 个真实岗位或具体机会，以及你现在的判断。',
    action: '找 1 个真实岗位，记录它的学历、技能和筛选要求；再对照今天看到的观点，写下“符合 / 不符合 / 还不确定”。',
    done: '你留下了一条真实记录，并能说清楚它支持了哪条观点，或让哪条观点需要修正。',
  };
  const task = conflict.currentTask || conflict.nextTask || fallbackTask;
  const sourceItems = (conflict.roles || []).flatMap((role) => role?.sourceItems || []);
  const hasZhihuSources = Number(sourceStats?.zhihuChosen || 0) > 0
    || sourceItems.some((item) => sourceKind(item) === 'zhihu');
  const hasWebSources = Number(sourceStats?.webChosen || 0) > 0
    || sourceItems.some((item) => sourceKind(item) === 'web');
  const hasVerifiableSources = hasZhihuSources || hasWebSources;
  const sourceIntro = demo
    ? `下面是根据你的处境生成的示例观点，共 ${conflict.roles.length} 个山头。`
    : !hasVerifiableSources
      ? '本次没有找到可核验原文，下面内容只能作为待验证假设。'
      : hasZhihuSources && hasWebSources
        ? `下面整理了知乎与全网来源中的 ${conflict.roles.length} 个山头。`
        : hasZhihuSources
          ? `下面整理了知乎原始来源中的 ${conflict.roles.length} 个山头。`
        : `本次未找到合适的知乎来源，下面整理了可打开核对的全网资料，共 ${conflict.roles.length} 个山头。`;
  const taskIsEvidenceOnly = !demo && !hasVerifiableSources;
  const taskVerify = taskIsEvidenceOnly
    ? `当前没有可核验原文，先取到 1 条能打开的原始资料，再判断“${(task.verify || fallbackTask.verify).slice(0, 48)}”是否成立。`
    : (task.verify || task.goal || fallbackTask.verify);

  function toggle(i) {
    setOpenIdx((cur) => (cur === i ? null : i)); // 手风琴：展开一个，其他收起
  }

  return (
    <section className="card wall">
      <div className="wall-kicker">{demo ? '01 · 演示观点' : hasVerifiableSources ? '01 · 观点与原文' : '01 · 待验证假设'}</div>
      <h2>同一个问题，为什么会有不同答案？</h2>
      <p className="muted">{sourceIntro}先看每条观点的主张、适用处境和边界，再决定哪条值得你验证。</p>

      {persona && (() => {
        const pl = personaLabel(persona);
        if (!pl) return null;
        return <div className="wall-persona">你的处境：{esc(pl)}（下面每个观点都结合它来呈现，而非泛泛而谈）</div>;
      })()}

      <blockquote className="conflict-summary"><span className="summary-label">这次分歧</span>{esc(conflict.summary)}</blockquote>

      <div className="roles">
        {conflict.roles.map((s, i) => (
          <article key={i} className={`role-card${openIdx === i ? ' active' : ''}`}>
            <button
              type="button"
              className="role-head"
              aria-expanded={openIdx === i}
              aria-controls={`role-body-${i}`}
              onClick={() => toggle(i)}
            >
              <div className="role-id">
                <span className="role-hill" style={{ background: HILL[i % HILL.length] }} />
                <span className={`role-mark role-mark-${(i % 5) + 1}`} aria-hidden="true">{i + 1}</span>
                <div>
                  <div className="role-name">{esc(s.name || s.stance || `第 ${i + 1} 派`)}</div>
                  <div className="role-form">{esc(s.form || s.stance || '')}</div>
                </div>
              </div>
              <span className="role-toggle">{openIdx === i ? '收起' : '查看这条观点'}</span>
            </button>
            {openIdx !== i && <PreviewLine s={s} i={i} />}
            {openIdx === i && (
              <div className="role-body" id={`role-body-${i}`}>
                <div className="role-stance-box">{esc(s.stance)}</div>
                {s.persona && <p className="role-persona">{esc(s.persona)}</p>}
                <p><b>最硬论据：</b><LongText text={s.coreArg} max={120} /></p>
                <p><b>适合哪种赶路人：</b><LongText text={s.bestFor} max={80} /></p>
                <p><b>这条路的边界：</b><LongText text={cleanBoundary(s)} max={80} /></p>
                <p className="match-reason">为什么贴你：<LongText text={s.matchReason || '按你的路标写的'} max={140} /></p>
                <div className="source-tags">
                  <span className="source-tag from"><span className="st-k">来源</span>{esc(roleSourceLabel(s, demo))}</span>
                  <span className="source-tag match"><span className="st-k">匹配</span>{esc(s.matchReason || '你的路标')}</span>
                </div>
                <div className="rebut">
                  <b>对其他山头的质疑：</b>
                  {makeFallbackRebut(s, conflict.roles).map((r, k) => <RebutItem key={k} r={r} roles={conflict.roles} />)}
                </div>
                <div className="sources">
                  <span className="muted">{demo ? '示例脚印（点击翻面）：' : '原文脚印（点击翻面）：'}</span>
                  {(() => {
                    // 前端兜底去重：后端已经按归一化标题去重，这里再按渲染顺序去重一次
                    const seen = new Set();
                    const uniq = (s.sourceItems || []).filter((it) => {
                      const k = normTitle(it.title) || it.url;
                      if (!k) return true;
                      if (seen.has(k)) return false;
                      seen.add(k);
                      return true;
                    });
                    return uniq.length
                      ? uniq.map((it, j) => <SourceCard key={j} item={it} demo={demo} />)
                      : null;
                  })()}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
      <section className={`current-task-card${taskStarted ? ' started' : ''}`} aria-labelledby="current-task-title">
        <div className="current-task-kicker">02 · {taskIsEvidenceOnly ? '先把假设交给现实' : '把观点交给现实'}</div>
        <h3 id="current-task-title">{taskIsEvidenceOnly ? '先取一条可核验证据' : '先验证一个小问题'}</h3>
        <div className="current-task-grid">
          <div className="current-task-item current-task-focus"><b>{taskIsEvidenceOnly ? '先取证什么' : '要验证什么'}</b><p>{esc(taskVerify)}</p></div>
          <div className="current-task-item"><b>需要什么输入</b><p>{esc(task.input || task.inputs || fallbackTask.input)}</p></div>
          <div className="current-task-item current-task-focus"><b>现在做什么</b><p>{esc(task.action || task.do || task.steps || fallbackTask.action)}</p></div>
          <div className="current-task-item"><b>完成标准</b><p>{esc(task.done || task.output || task.acceptance || fallbackTask.done)}</p></div>
        </div>
        <div className="current-task-actions">
          <button type="button" className="primary" onClick={() => {
            setTaskStarted(true);
            if (roadData) saveRoad(roadData, '__current', { started: true, startedAt: Date.now() });
          }} disabled={taskStarted}>
            {taskStarted ? '已开始这一步' : '开始这一步'}
          </button>
          {taskStarted && <span className="current-task-status">完成后回来记录结果，系统不会替你提交或联系任何人。</span>}
        </div>
      </section>
      {onNext && (
        <div className="wall-next">
          <button type="button" className="chip primary" onClick={onNext}>
            继续做辨向自测（可选） →
          </button>
        </div>
      )}
    </section>
  );
}
