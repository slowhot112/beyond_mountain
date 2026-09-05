import React, { useState } from 'react';
import { esc, brief, normTitle, personaLabel } from '../lib.js';

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

function SourceCard({ item }) {
  const [flip, setFlip] = useState(false);
  // 全网结果没有点赞数据（网页不点赞），它按权威等级参与排序；这里把来源与可信度标出来，让"信谁"有依据
  const isWeb = item.source === 'web';
  const parts = [];
  if (item.author) parts.push(item.author);
  if (item.voteUp) parts.push(`${item.voteUp} 赞`);
  const meta = parts.join(' · ');
  const title = cleanSourceTitle(item.title);
  return (
    <div className={`source-card${flip ? ' flipped' : ''}${isWeb ? ' web' : ''}`} onClick={() => setFlip((f) => !f)}>
      <div className="source-front">
        <div className="source-title">{esc(title)}</div>
        <div className="source-badges">
          <span className={`src-badge ${isWeb ? 'web' : 'zhihu'}`}>{isWeb ? '全网' : '知乎'}</span>
          {item.authority ? <span className="src-badge auth">权威 {esc(String(item.authority))} 级</span> : null}
        </div>
        <div className="source-meta">{esc(meta || '翻面看梗概')}</div>
      </div>
      <div className="source-back">
        <div className="source-brief">{esc(brief(item.summary))}</div>
        <a href={item.url} target="_blank" rel="noreferrer" className="source-link" onClick={(e) => e.stopPropagation()}>{isWeb ? '打开原文 →' : '打开知乎原文 →'}</a>
      </div>
    </div>
  );
}

function RebutItem({ r, roles }) {
  const target = typeof r === 'string' ? null : roles.find((x) => x.id === r.to);
  const text = typeof r === 'string' ? r : (r.text || '');
  // 如果角色名带「·」，只显示派系前缀，避免 target 名长得像文章标题、和来源卡片视觉重复
  const targetFull = target?.name || target?.stance || r.to;
  const targetShort = (target?.name?.split('·')[0]?.trim()) || target?.name || target?.stance || r.to;
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
  const zh = items.filter((it) => (it.source || 'zhihu') !== 'web').length;
  const web = items.length - zh;
  return (
    <div className="role-preview">
      <span className="role-preview-core">{short}</span>
      <span className="role-preview-meta">
        {items.length ? `来源 ${items.length} 条（知乎 ${zh} · 全网 ${web}） · ` : ''}适合 {esc((s.bestFor || '').slice(0, 24) || '…')}
      </span>
    </div>
  );
}

export default function ConflictWall({ conflict, persona, onNext }) {
  if (!conflict) return null;
  const [openIdx, setOpenIdx] = useState(null); // 默认全折叠，避免一进来就被单个山头占满屏

  function toggle(i) {
    setOpenIdx((cur) => (cur === i ? null : i)); // 手风琴：展开一个，其他收起
  }

  return (
    <section className="card wall">
      <h2>② 众声对照（先看清山势）</h2>
      <p className="muted">下面是知乎上互相交锋的 {conflict.roles.length} 个硬立场。先全部扫一眼标题和一句话摘要，再点开看详情；翻面可见原文梗概。该信谁，下一步再辨。</p>

      {persona && (() => {
        const pl = personaLabel(persona);
        if (!pl) return null;
        return <div className="wall-persona">你的处境：{esc(pl)}（下面每个观点都结合它来呈现，而非泛泛而谈）</div>;
      })()}

      <blockquote className="conflict-summary">{esc(conflict.summary)}</blockquote>

      <div className="roles">
        {conflict.roles.map((s, i) => (
          <article key={i} className={`role-card${openIdx === i ? ' active' : ''}`}>
            <header className="role-head" onClick={() => toggle(i)}>
              <div className="role-id">
                <span className="role-avatar">{s.avatar || '刘'}</span>
                <div>
                  <div className="role-name">{esc(s.name || s.stance || `角色 ${i + 1}`)}</div>
                  <div className="role-form">{esc(s.form || s.stance || '')}</div>
                </div>
              </div>
              <span className="role-toggle">{openIdx === i ? '收起 ▲' : '展开 ▼'}</span>
            </header>
            {openIdx !== i && <PreviewLine s={s} i={i} />}
            {openIdx === i && (
              <div className="role-body">
                <div className="role-stance-box">{esc(s.stance)}</div>
                {s.persona && <p className="role-persona">{esc(s.persona)}</p>}
                <p><b>最硬论据：</b><LongText text={s.coreArg} max={120} /></p>
                <p><b>适合哪种赶路人：</b><LongText text={s.bestFor} max={80} /></p>
                <p><b>这条路的边界：</b><LongText text={cleanBoundary(s)} max={80} /></p>
                <p className="match-reason">为什么贴你：<LongText text={s.matchReason || '基于你的路标生成'} max={140} /></p>
                <div className="source-tags">
                  <span className="source-tag from"><span className="st-k">来源</span>{esc((s.sourceItems && s.sourceItems[0] && s.sourceItems[0].author) || '知乎真实讨论')}</span>
                  <span className="source-tag match"><span className="st-k">匹配</span>{esc(s.matchReason || '你的路标')}</span>
                </div>
                <div className="rebut">
                  <b>对其他山头的质疑：</b>
                  {makeFallbackRebut(s, conflict.roles).map((r, k) => <RebutItem key={k} r={r} roles={conflict.roles} />)}
                </div>
                <div className="sources">
                  <span className="muted">原文脚印（点击翻面）：</span>
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
                      ? uniq.map((it, j) => <SourceCard key={j} item={it} />)
                      : null;
                  })()}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
      {onNext && (
        <div className="wall-next">
          <button type="button" className="chip primary" onClick={onNext}>
            下一步：去辨向自测 →
          </button>
        </div>
      )}
    </section>
  );
}
