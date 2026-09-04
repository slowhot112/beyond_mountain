import React from 'react';

// 「我的山径」：有历史时展示成长山径（时间线节点），无历史也露出「暂无记录」引导，
// 让"长期陪伴"的概念随时看得见。知识库对话已统一由右下角常驻的刘看山承担。
export default function Landing({ onStart, records = [], onOpen }) {
  const list = Array.isArray(records) ? records : [];
  const has = list.length > 0;

  return (
    <section className="card landing">
      {has ? (
        <h1 className="landing-title">我的山径</h1>
      ) : (
        <>
          <div className="landing-figure" role="img" aria-label="刘看山形象占位框，官方立绘待替换">
            <span className="landing-figure-emoji" aria-hidden="true">🦊</span>
            <span className="landing-figure-label" aria-hidden="true">刘看山</span>
          </div>
          <h1 className="landing-title">山外山</h1>
        </>
      )}

      <p className="landing-tagline">
        {has
          ? `你的山径上已有 ${list.length} 座山头${list.length >= 30 ? '（最多保留最近 30 个）' : ''}。每次炼金都是插下的一面小旗——点开任意一座，都能回到那天你看到的山势。`
          : '山外有山，路在脚下。每一次炼金，都是你在山径上插的一面小旗。'}
      </p>

      {!has && (
        <p className="landing-desc">
          知乎上的每一条过来人经验，都是一座有人翻过的山。山外山不替你决定翻哪座山——它接入知乎搜索、全网搜索与知乎直答，从真实高赞讨论里拾起与你处境相近的脚印，摆成几种声音。
        </p>
      )}

      <div className="landing-actions">
        <button className="primary landing-start" onClick={onStart}>
          {has ? '再插一面旗 →' : '标记我的位置 →'}
        </button>
        {!has && <span className="landing-hint muted">先说说你站在哪个路口，约两分钟生成你的路标</span>}
      </div>

      <div className="growth-map">
        {has ? (
          list.map((r) => (
            <button key={r.id} className="map-node" onClick={() => onOpen && onOpen(r)}>
              <span className="map-dot" aria-hidden="true" />
              <div className="map-card">
                <div className="map-topic">{r.topic || '未命名'}</div>
                <div className="map-meta">
                  {new Date(r.ts).toLocaleDateString()}
                  {r.fallback && <em className="record-flag" title="这次知乎直答没连上，展示的是真实搜索结果的原始素材，未经过 AI 整合"> · 原始山径</em>}
                  {!r.fallback && r.lowConfidence && <em className="record-flag" title="知乎上与你主题直接相关的高赞讨论不多，内容由相近主题的真实讨论兜底"> · 素材偏少</em>}
                </div>
              </div>
            </button>
          ))
        ) : (
          <div className="growth-map-empty">
            你的成长山径 · <b>暂无记录</b><br />
            炼出第一个炼金包后，这里会亮起一座座山头，串成你的路。
          </div>
        )}
      </div>
    </section>
  );
}
