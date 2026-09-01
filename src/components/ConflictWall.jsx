import React, { useState } from 'react';
import { esc, brief, normTitle } from '../lib.js';

function SourceCard({ item }) {
  const [flip, setFlip] = useState(false);
  const meta = [item.author, item.voteUp ? `${item.voteUp} 赞` : ''].filter(Boolean).join(' · ');
  return (
    <div className={`source-card${flip ? ' flipped' : ''}`} onClick={() => setFlip((f) => !f)}>
      <div className="source-front">
        <div className="source-title">{esc(item.title)}</div>
        <div className="source-meta">{esc(meta || '翻面看梗概')}</div>
      </div>
      <div className="source-back">
        <div className="source-brief">{esc(brief(item.summary))}</div>
        <a href={item.url} target="_blank" rel="noreferrer" className="source-link" onClick={(e) => e.stopPropagation()}>打开知乎原文 →</a>
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

export default function ConflictWall({ conflict }) {
  if (!conflict) return null;
  const [openIdx, setOpenIdx] = useState(0);

  return (
    <section className="card wall">
      <h2>② 主流观点（先建立整体认识）</h2>
      <p className="muted">先用最强方式把两派主流观点摆清楚，帮你快速建立对这个问题的整体认识；翻面可见来源文章梗概。判断「该信谁」留到下一步。</p>

      <blockquote className="conflict-summary">{esc(conflict.summary)}</blockquote>

      <div className="roles">
        {conflict.roles.map((s, i) => (
          <article key={i} className={`role-card${openIdx === i ? ' active' : ''}`}>
            <header className="role-head" onClick={() => setOpenIdx(openIdx === i ? null : i)}>
              <div className="role-id">
                <span className="role-avatar">{s.avatar || '刘'}</span>
                <div>
                  <div className="role-name">{esc(s.name || s.stance || `角色 ${i + 1}`)}</div>
                  <div className="role-form">{esc(s.form || s.stance || '')}</div>
                </div>
              </div>
              <span className="role-toggle">{openIdx === i ? '收起 ▲' : '展开 ▼'}</span>
            </header>
            {openIdx === i && (
              <div className="role-body">
                <div className="role-stance-box">{esc(s.stance)}</div>
                {s.persona && <p className="role-persona">{esc(s.persona)}</p>}
                <p><b>最强论点：</b><LongText text={s.coreArg} max={120} /></p>
                <p><b>适合谁：</b><LongText text={s.bestFor} max={80} /></p>
                <p><b>边界：</b><LongText text={s.boundary} max={80} /></p>
                <p className="match-reason">匹配你的处境：{esc(s.matchReason || '基于你的处境卡生成')}</p>
                <div className="source-tags">
                  <span className="source-tag from"><span className="st-k">来源</span>{esc((s.sourceItems && s.sourceItems[0] && s.sourceItems[0].author) || '知乎真实讨论')}</span>
                  <span className="source-tag match"><span className="st-k">匹配</span>{esc(s.matchReason || '你的处境卡')}</span>
                </div>
                <div className="rebut">
                  <b>对其他角色的质疑：</b>
                  {Array.isArray(s.rebuts) && s.rebuts.length
                    ? s.rebuts.map((r, k) => <RebutItem key={k} r={r} roles={conflict.roles} />)
                    : <span className="muted">暂无交锋</span>}
                </div>
                <div className="sources">
                  <span className="muted">来源文章（点击翻面）：</span>
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
    </section>
  );
}
