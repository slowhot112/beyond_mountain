import React from 'react';
import { esc } from '../lib.js';

// 结果页总览：把 ②③④ 拆成三个明确入口，避免模块混在一起分不清
const ENTRIES = [
  {
    step: 'result1',
    no: '②',
    icon: '🔥',
    title: '主流观点',
    sub: '看看别人怎么说',
    desc: '把知乎上互相矛盾的高赞观点摆清楚，翻面可见来源原文。',
    meta: (d) => `${d?.conflict?.roles?.length || 0} 个视角`,
  },
  {
    step: 'result2',
    no: '③',
    icon: '⚖️',
    title: '判断力自测',
    sub: '逼自己站队',
    desc: '5 道情境题，先选立场再标确定程度，选项不合意可以自己写。',
    meta: (d) => `${d?.quiz?.length || 0} 题 · 约 3 分钟`,
  },
  {
    step: 'result3',
    no: '④',
    icon: '🎯',
    title: '行动地图',
    sub: '先求小赢',
    desc: '按你处境卡里的时间压力，排好今天 / 本周 / 本月的下一步。',
    meta: (d) => `${d?.actions?.length || 0} 步`,
    locked: (quizDone) => !quizDone,
  },
];

export default function ResultHub({ data, quizDone, onGoto }) {
  return (
    <section className="card hub">
      <h2>炼金包已生成：{esc(data?.topic)}</h2>
      <p className="muted">下面三件事，按顺序走效果最好，也可以单独进。行动地图需要先做完自测。</p>
      <div className="hub-grid">
        {ENTRIES.map((e) => {
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
                <span className="hub-no">{e.no}</span>
                <span className="hub-icon" aria-hidden="true">{e.icon}</span>
              </div>
              <h3 className="hub-title">{e.title}</h3>
              <div className="hub-sub">{e.sub}</div>
              <p className="hub-desc">{e.desc}</p>
              <div className="hub-foot">
                <span className="hub-meta">{e.meta(data)}</span>
                <span className="hub-cta">{locked ? '需先完成自测' : '进入 →'}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
