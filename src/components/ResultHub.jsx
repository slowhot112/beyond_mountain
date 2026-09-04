import React from 'react';
import { esc } from '../lib.js';

// 结果页总览：把 ②③④ 拆成三个明确入口，避免模块混在一起分不清
const ENTRIES = [
  {
    step: 'result1',
    no: '②',
    icon: '🔥',
    title: '众声对照',
    sub: '听听不同脚印',
    desc: '从知乎真实高赞讨论与全网补充视角中，拾起两三种最硬的立场，摆成对照。翻面可见原文脚印。',
    meta: (d) => `${d?.conflict?.roles?.length || 0} 个山头`,
  },
  {
    step: 'result2',
    no: '③',
    icon: '⚖️',
    title: '辨向自测',
    sub: '先站一站',
    desc: '5 道情境题，先选你倾向哪一派，再标你有多确定。选项不合意可以自己写。',
    meta: (d) => `${d?.quiz?.length || 0} 题 · 约 3 分钟`,
  },
  {
    step: 'result3',
    no: '④',
    icon: '🎯',
    title: '脚下三步',
    sub: '先迈一小步',
    desc: '按你的时间窗口，排好今天 / 本周 / 本月的下一步。',
    meta: (d) => `${d?.actions?.length || 0} 步`,
    locked: (quizDone) => !quizDone,
  },
];

export default function ResultHub({ data, quizDone, onGoto }) {
  return (
    <section className="card hub">
      <h2>山径图已绘成：{esc(data?.topic)}</h2>
      {data?.searchStats && (() => {
        const s = data.searchStats;
        const total = Math.max(1, s.totalChosen || (s.zhihuChosen + s.webChosen));
        const zhPct = Math.round((s.zhihuChosen / total) * 100);
        const webPct = 100 - zhPct;
        const isFb = s.mode === 'fallback';
        return (
          <div className="search-stats">
            <span className="ss-title">🔍 检索统筹</span>
            {isFb ? (
              <>
                <span className="ss-line">知乎直答这会儿没连上，已切换到「原始山径」模式：把知乎 <b>{s.zhihuFound}</b> 条 + 全网 <b>{s.webFound}</b> 条脚印都摆出来了，没再让 AI 精选一遍。你先看原始素材，哪些前提和你的处境像，就重点读哪些。</span>
                <span className="ss-reason ss-warn">注意：这些素材来自真实讨论，但未经整合，可信度需要你自己判断。</span>
              </>
            ) : (
              <>
                <span className="ss-line">从 <b>{s.queries}</b> 个角度检索，知乎站内拾得 <b>{s.zhihuFound}</b> 条、全网 <b>{s.webFound}</b> 条。</span>
                <div className="ss-bar">
                  <span className="ss-fill zhihu" style={{ width: zhPct + '%' }}>知乎 {s.zhihuChosen}</span>
                  <span className="ss-fill web" style={{ width: webPct + '%' }}>全网 {s.webChosen}</span>
                </div>
                <span className="ss-reason">{s.rationale}</span>
              </>
            )}
          </div>
        );
      })()}
      <p className="muted">这是你的「观山台」：先登台俯瞰整片山势——众声、辨向、脚下路，三步顺着走最清楚。每个页面底部都有「下一步」引你往下走；当然，也可以随时从顶部导航自由跳转。脚下路需先做完辨向自测。</p>
      <div className="hub-grid">
        {ENTRIES.map((e, idx) => {
          const locked = e.locked ? e.locked(quizDone) : false;
          return (
            <article
              key={e.step}
              className={`hub-card${locked ? ' locked' : ''}`}
              onClick={() => !locked && onGoto(e.step)}
              role="button"
              tabIndex={locked ? -1 : 0}
              onKeyDown={(ev) => { if (!locked && (ev.key === 'Enter' || ev.key === ' ')) onGoto(e.step); }}
            >
              <div className="hub-top">
                <span className="hub-step-label">第 {idx + 1} 步</span>
                <span className="hub-icon" aria-hidden="true">{e.icon}</span>
              </div>
              <h3 className="hub-title">{e.title}</h3>
              <div className="hub-sub">{e.sub}</div>
              <p className="hub-desc">{e.desc}</p>
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
