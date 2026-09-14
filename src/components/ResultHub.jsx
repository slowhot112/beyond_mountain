import React from 'react';
import { esc } from '../lib.js';

// 结果页总览：先给一条主路径，其余能力作为可见但次级的选择。
const ENTRIES = [
  {
    step: 'result1',
    no: '②',
    icon: '01',
    title: '众声对照',
    sub: '听听不同脚印',
    desc: '先看同一个问题为什么会有不同答案，以及每种答案分别适合谁。',
    meta: (d) => `${d?.conflict?.roles?.length || 0} 个山头`,
  },
  {
    step: 'result2',
    no: '③',
    icon: '02',
    title: '辨向自测',
    sub: '先站一站',
    desc: '用 5 道情境题确认你真正相信什么，以及哪里还没有想清楚。',
    meta: (d) => `${d?.quiz?.length || 0} 题 · 约 3 分钟`,
  },
  {
    step: 'result3',
    no: '④',
    icon: '03',
    title: '行动路线',
    sub: '让现实来验证',
    desc: '把你的判断变成可以验证、可以回填结果的一条行动路线。',
    meta: (d) => d?.roadmap?.horizon || `${d?.actions?.length || 0} 个起步动作`,
    locked: (quizDone) => !quizDone,
  },
];

function isZhihuUrl(url) {
  try { return /(^|\.)zhihu\.com$/i.test(new URL(url).hostname); } catch { return false; }
}

export default function ResultHub({ data, quizDone, onGoto }) {
  const isDemo = Boolean(data?.mock);
  const linkedSources = [
    ...(Array.isArray(data?.sources) ? data.sources : []),
    ...(data?.conflict?.roles || []).flatMap((role) => role?.sourceItems || []),
  ];
  const verifiableSources = linkedSources.filter((item) => item?.url && !item.demo && item.source !== 'demo');
  const hasZhihuSources = Number(data?.searchStats?.zhihuChosen || 0) > 0
    || verifiableSources.some((item) => isZhihuUrl(item.url));
  const hasWebSources = Number(data?.searchStats?.webChosen || 0) > 0
    || verifiableSources.some((item) => item.source === 'web');
  const hasVerifiableSources = hasZhihuSources || hasWebSources || verifiableSources.length > 0;
  const sourceMessage = isDemo
    ? '当前是演示素材，不代表真实知乎文章。'
    : !hasVerifiableSources
      ? '本次没有找到可核验原文，以下内容只可作为待验证假设。'
      : hasZhihuSources && hasWebSources
        ? '已找到知乎原始来源，并用全网资料补充；可打开原文核对。'
        : hasZhihuSources
          ? '已找到知乎原始来源，可打开原文核对。'
          : '本次未找到合适的知乎来源，当前仅展示可打开核对的全网资料。';
  const heroTitle = isDemo
    ? '先看示例观点，再了解完整流程'
    : hasVerifiableSources
      ? '先看观点与原文，再决定下一步'
      : '先把假设交给现实验证';
  const heroAction = isDemo ? '先看演示观点' : hasVerifiableSources ? '查看观点与原文' : '查看待验证假设';
  return (
    <section className="card hub">
      <div className="hub-hero">
        <div className="hub-main">
          <div className="hub-kicker">你的第一个结果已经准备好</div>
          <h2>{heroTitle}</h2>
          <p className="hub-topic">你正在判断：{esc(data?.topic)}</p>
          <p className="hub-lead">先看不同答案适合什么处境，再决定要不要自测。完整路线不会在第一次使用时压给你。</p>
          <div className="hub-next-action"><span>现在只做一件事</span><b>打开观点墙，先找到与你处境最接近的一条判断</b><small>看完后你可以收起页面，不需要立刻做决定。</small></div>
          <button type="button" className="primary hub-primary" onClick={() => onGoto('result1')}>{heroAction} <span aria-hidden="true">→</span></button>
        </div>
        <aside className="hub-source-note" aria-label="本次资料来源">
          <span className="hub-trust-dot" aria-hidden="true" />
          <div><b>本次资料来源</b><p>{sourceMessage}</p><small>{verifiableSources.length ? `已整理 ${verifiableSources.length} 条可打开来源` : '当前没有可核验链接'}</small></div>
        </aside>
      </div>
      {data?.searchStats && <details className="search-details"><summary>查看本次资料来源与检索范围</summary>{(() => {
        const s = data.searchStats;
        const total = Math.max(1, s.totalChosen || (s.zhihuChosen + s.webChosen));
        const zhPct = Math.round((s.zhihuChosen / total) * 100);
        const webPct = 100 - zhPct;
        const isFb = s.mode === 'fallback';
        return (
          <div className="search-stats">
            <span className="ss-title">🔍 这次翻了哪些山头</span>
            {isFb ? (
              <>
                <span className="ss-line">知乎直答这会儿没连上，已切换到「原始山径」模式：把知乎 <b>{s.zhihuFound}</b> 条 + 全网 <b>{s.webFound}</b> 条脚印都摆出来了，没再让 AI 精选一遍。你先看原始素材，哪些前提和你的处境像，就重点读哪些。</span>
                <span className="ss-reason ss-warn">提醒：这些都是真实讨论，但没经过二次整理，哪些可信，你自己拿主意。</span>
              </>
            ) : (
              <>
                <span className="ss-line">从 <b>{s.queries}</b> 个方向找过去，知乎站内翻到 <b>{s.zhihuFound}</b> 条、全网 <b>{s.webFound}</b> 条。</span>
                <div className="ss-bar">
                  <span className="ss-fill zhihu" style={{ width: zhPct + '%' }}>知乎 {s.zhihuChosen}</span>
                  <span className="ss-fill web" style={{ width: webPct + '%' }}>全网 {s.webChosen}</span>
                </div>
                <span className="ss-reason">{s.rationale}</span>
              </>
            )}
          </div>
        );
      })()}</details>}
      <div className="hub-path-heading">
        <span>接下来怎么用</span>
        <small>先做第 1 步，后两步按需进入</small>
      </div>
      <div className="hub-route" aria-label="推荐使用顺序">
        <span className="hub-route-step"><b>1</b>先看不同声音</span><i aria-hidden="true">→</i>
        <span className="hub-route-step"><b>2</b>辨认自己的倾向</span><i aria-hidden="true">→</i>
        <span className="hub-route-step"><b>3</b>只选一个现实验证</span>
      </div>
      <div className="hub-grid">
        {ENTRIES.map((e, idx) => {
          const locked = e.locked ? e.locked(quizDone) : false;
          return (
            <article
              key={e.step}
              className={`hub-card${idx === 0 ? ' hub-card-featured' : ''}${locked ? ' locked' : ''}`}
              onClick={() => !locked && onGoto(e.step)}
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-disabled={locked ? 'true' : undefined}
              onKeyDown={(ev) => { if (!locked && (ev.key === 'Enter' || ev.key === ' ')) onGoto(e.step); }}
            >
              <div className="hub-top">
                <span className="hub-step-label">第 {e.no} 步</span>
                <span className="hub-icon" aria-hidden="true">{e.icon}</span>
              </div>
              <h3 className="hub-title">{e.title}</h3>
              <div className="hub-sub">{e.sub}</div>
              <p className="hub-desc">{e.desc}</p>
              {locked && <div className="hub-path-note">完成辨向后，才会生成属于你的验证任务。</div>}
              <div className="hub-foot">
                <span className="hub-meta">{e.meta(data)}</span>
                <span className="hub-cta">{locked ? '需先完成辨向' : '进入 →'}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
