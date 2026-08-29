import React, { useState } from 'react';
import { STAGES, GOALS, INDUSTRIES, DEFAULT_CARD } from '../lib.js';
import CityPicker from './CityPicker.jsx';

export default function Onboarding({ initial, onBuildCard, history }) {
  const [card, setCard] = useState(initial || DEFAULT_CARD);
  const [cityOpen, setCityOpen] = useState(false);
  const ind = INDUSTRIES.find((x) => x.id === card.industry) || INDUSTRIES[0];
  const usingCustom = !!(card.customIndustry && card.customIndustry.trim());

  function set(patch) { setCard((c) => ({ ...c, ...patch })); }
  function toggleGoal(id) {
    setCard((c) => {
      const has = c.goals.includes(id);
      if (id === 'unknown') return { ...c, goals: has ? [] : ['unknown'] };
      const goals = has ? c.goals.filter((g) => g !== id) : [...c.goals.filter((g) => g !== 'unknown'), id];
      return { ...c, goals };
    });
  }

  const canBuild = card.stage && card.goals.length > 0 && (card.industry || card.customIndustry?.trim());

  return (
    <section className="card onb">
      <h2>① 先告诉我你的处境（建档）</h2>
      <p className="muted">选得越准，炼出的判断越贴你。不上传简历也能完整使用。行业和领域都能自己写。</p>

      <div className="onb-block">
        <div className="onb-label">当前阶段（单选）</div>
        <div className="chips">
          {STAGES.map((s) => (
            <button key={s.id} className={`chip${card.stage === s.id ? ' on' : ''}`} onClick={() => set({ stage: s.id })}>{s.name}</button>
          ))}
        </div>
      </div>

      <div className="onb-block">
        <div className="onb-label">当前目标（可多选，或选“暂未明确”）</div>
        <div className="chips">
          {GOALS.map((g) => (
            <button key={g.id} className={`chip${card.goals.includes(g.id) ? ' on' : ''}`} onClick={() => toggleGoal(g.id)}>{g.name}</button>
          ))}
        </div>
      </div>

      <div className="onb-grid">
        <label>行业{usingCustom ? <span className="custom-hint">（已用下方自定义，此栏不生效）</span> : ''}
          {usingCustom ? (
            <select value="__custom__" disabled>
              <option value="__custom__">无</option>
            </select>
          ) : (
            <select value={card.industry} onChange={(e) => { set({ industry: e.target.value, sub: INDUSTRIES.find((x) => x.id === e.target.value).subs[0] }); }}>
              {INDUSTRIES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
        </label>
        <label>细分领域{usingCustom ? <span className="custom-hint">（已用下方自定义，此栏不生效）</span> : ''}
          {usingCustom ? (
            <select value="__custom__" disabled>
              <option value="__custom__">无</option>
            </select>
          ) : (
            <select value={card.sub} onChange={(e) => set({ sub: e.target.value })}>
              {ind.subs.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </label>
      </div>

      <label className="onb-text" style={{ marginTop: 10 }}>
        或自己填写行业/领域（不区分行业与细分，填写后优先使用）
        <input type="text" placeholder="如：半导体 / 心理咨询 / 射频工程师 / 婚恋咨询"
          value={card.customIndustry || ''}
          onChange={(e) => set({ customIndustry: e.target.value })} />
      </label>

      <div className="onb-block" style={{ marginTop: 16 }}>
        <div className="onb-label">目标城市（选填，精确到市）</div>
        <div className="city-select-row">
          <button className="chip" onClick={() => setCityOpen(true)}>
            {card.city || '+ 选择城市'}
          </button>
          {card.city && <button className="chip ghost" onClick={() => set({ city: '' })}>清除</button>}
        </div>
      </div>

      <label className="onb-text">时间压力（选填）
        <input type="text" placeholder="如：3个月内 / 秋招前" value={card.timePressure} onChange={(e) => set({ timePressure: e.target.value })} />
      </label>

      <label className="onb-text">当前最困惑的问题（必填，决定检索与对照主题）
        <textarea rows={2} placeholder="例如：AIGC 校招到底卷不卷，我这种背景有没有机会" value={card.confusion} onChange={(e) => set({ confusion: e.target.value })} />
      </label>

      {card.resumeExtracted && (
        <div className="resume-note">✓ 已解析简历背景：{card.education.slice(0, 60)}… <button className="link" onClick={() => set({ education: '', resumeExtracted: false })}>清除</button></div>
      )}

      <div className="onb-actions">
        <button className="primary" disabled={!canBuild || !card.confusion.trim()} onClick={() => onBuildCard(card)}>
          生成处境卡 →
        </button>
        {!card.confusion.trim() && <span className="muted">请先填写“当前最困惑的问题”</span>}
      </div>

      {history?.topics?.length > 0 && (
        <details className="history">
          <summary>历史话题（本地）</summary>
          <div className="chips">
            {history.topics.map((t) => <span key={t} className="chip ghost">{t}</span>)}
          </div>
        </details>
      )}

      {cityOpen && (
        <CityPicker
          value={card.city}
          onChange={(city) => set({ city })}
          onClose={() => setCityOpen(false)}
        />
      )}
    </section>
  );
}
