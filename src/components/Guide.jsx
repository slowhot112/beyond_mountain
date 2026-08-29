import React from 'react';

export default function Guide({ onStart }) {
  return (
    <div className="guide">
      <div className="guide-hero">
        <div className="guide-mascot">🐻‍❄️</div>
        <div className="guide-kicker">山外山 · 刘看山陪你炼判断</div>
        <h1 className="guide-title">翻过一座座<span className="hl">没有尽头的大山</span></h1>
        <p className="guide-sub">
          求职像翻山——翻过一座，前面总还有更高的。山外山不替你选翻哪座，
          而是把知乎上真实的过来人经验，按你当下的处境重新摆好，
          让你看清自己站在哪、脚下是什么路、又该往哪迈第一步。
        </p>
        <div className="guide-points">
          <div className="gp"><b>真数据</b>每条论点都标知乎来源，不编、不美化</div>
          <div className="gp"><b>钢人论证</b>对立双方都用最强方式互驳，不丑化</div>
          <div className="gp"><b>不替你定论</b>判断是你自己的，AI 只帮你炼</div>
        </div>
        <button className="primary guide-start" onClick={onStart}>开始建档，看清我的山 →</button>
        <p className="guide-note muted">不上传简历也能完整使用；你的数据只在本地，不出本机。</p>
      </div>
    </div>
  );
}
