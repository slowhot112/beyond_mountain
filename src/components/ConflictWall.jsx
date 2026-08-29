import React, { useState } from 'react';
import { esc, brief } from '../lib.js';

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
  return (
    <div className="rebut-item">
      <span className="rebut-arrow">→</span>
      <span>{esc(text)}{target && <span className="rebut-target">（针对 {esc(target.name || target.stance || r.to)}）</span>}</span>
    </div>
  );
}

export default function ConflictWall({ conflict }) {
  if (!conflict) return null;
  const [openIdx, setOpenIdx] = useState(0);

  return (
    <section className="card wall">
      <h2>② 观点对峙墙（钢人论证）</h2>
      <p className="muted">每个角色都被要求「用最强方式呈现对方论点，落到具体行业，不丑化对立面」。翻面可见来源文章梗概。</p>

      <blockquote className="conflict-summary">{esc(conflict.summary)}</blockquote>

      <div className="roles">
        {conflict.roles.map((s, i) => (
          <article key={i} className={`role-card${openIdx === i ? ' active' : ''}`} onClick={() => setOpenIdx(i)}>
            <header className="role-head">
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
                <p><b>最强论点：</b>{esc(s.coreArg)}</p>
                <p><b>适合谁：</b>{esc(s.bestFor)}</p>
                <p><b>边界：</b>{esc(s.boundary)}</p>
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
                  {(s.sourceItems && s.sourceItems.length)
                    ? s.sourceItems.map((it, j) => <SourceCard key={j} item={it} />)
                    : <span className="muted">（演示模式，无真实来源）</span>}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
