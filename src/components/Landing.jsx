import React from 'react';

// 工单02：静态刘看山引导页（PRD 模块5 降级方案）
// 纯静态展示，无任何 API / Secret 依赖（演示模式同样可见）。
// 刘看山形象此处为占位框，官方立绘到位后仅需替换 landing-figure 内部内容。
export default function Landing({ onStart }) {
  return (
    <section className="card landing">
      <div className="landing-figure" role="img" aria-label="刘看山形象占位框，官方立绘待替换">
        <span className="landing-figure-emoji" aria-hidden="true">🦊</span>
        <span className="landing-figure-label" aria-hidden="true">刘看山</span>
      </div>
      <h1 className="landing-title">山外山</h1>
      <p className="landing-tagline">山外有山，路在脚下。</p>

      <p className="landing-desc">
        知乎上的每一条过来人经验，都是一座有人翻过的山。有人劝你绕行，有人催你攀登，声音彼此打架。
      </p>
      <p className="landing-desc">
        山外山不替你决定翻哪座山——只把与你处境相似的人留下的真实脚印摆到你面前，帮你看清脚下的路况，第一步仍由你自己迈出。
      </p>

      <div className="landing-actions">
        <button className="primary landing-start" onClick={onStart}>开始建档 →</button>
        <span className="landing-hint muted">先说说你的处境，约两分钟生成属于你的处境卡</span>
      </div>
    </section>
  );
}
