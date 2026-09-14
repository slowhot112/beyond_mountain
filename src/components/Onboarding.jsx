import React, { useRef, useState } from 'react';
import { STAGES, GOALS, INDUSTRIES, DEFAULT_CARD } from '../lib.js';
import CityPicker from './CityPicker.jsx';

export default function Onboarding({ initial, onBuildCard, history, onDraftChange, onQuestionComplete }) {
  const [card, setCard] = useState(initial || DEFAULT_CARD);
  const [cityOpen, setCityOpen] = useState(false);
  const questionPrompted = useRef(false);
  const ind = INDUSTRIES.find((x) => x.id === card.industry) || INDUSTRIES[0];
  const usingCustom = !!(card.customIndustry && card.customIndustry.trim());

  function set(patch) {
    setCard((c) => {
      const next = { ...c, ...patch };
      onDraftChange?.(next);
      return next;
    });
  }
  function toggleGoal(id) {
    setCard((c) => {
      const has = c.goals.includes(id);
      const goals = id === 'unknown'
        ? (has ? [] : ['unknown'])
        : (has ? c.goals.filter((g) => g !== id) : [...c.goals.filter((g) => g !== 'unknown'), id]);
      const next = { ...c, goals };
      onDraftChange?.(next);
      return next;
    });
  }

  const canBuild = card.stage && card.goals.length > 0 && (card.industry || card.customIndustry?.trim());
  const completedCount = [card.stage, card.goals.length > 0, card.confusion.trim()].filter(Boolean).length;

  function finishQuestion() {
    if (!card.confusion.trim() || questionPrompted.current) return;
    questionPrompted.current = true;
    onQuestionComplete?.(card);
  }



  return (
    <section className="card onb">
      <div className="onb-eyebrow">开始前，只需要回答 3 件事</div>
      <h2>先说清你现在卡在哪里</h2>
      <p className="muted">我会先找知乎上的真实讨论，再把不同答案放在一起。城市、经历和时间压力都可以稍后补充。</p>
      <div className="onb-progress" aria-label={`建档进度，已完成 ${completedCount} 项，共 3 项`}>
        <div className="onb-progress-track"><span style={{ width: `${(completedCount / 3) * 100}%` }} /></div>
        <span>已完成 {completedCount}/3</span>
      </div>

      <div className={`onb-block${card.stage ? ' complete' : ''}`}>
        <div className="onb-label"><span className="onb-index">{card.stage ? '✓' : '01'}</span><span>你现在在哪段山路上</span><small>决定我优先找哪类过来人经验</small></div>
        <div className="chips">
          {STAGES.map((s) => (
            <button key={s.id} type="button" aria-pressed={card.stage === s.id} className={`chip${card.stage === s.id ? ' on' : ''}`} onClick={() => set({ stage: s.id })}>{s.name}</button>
          ))}
        </div>
      </div>

      <div className={`onb-block${card.goals.length ? ' complete' : ''}`}>
        <div className="onb-label"><span className="onb-index">{card.goals.length ? '✓' : '02'}</span><span>想朝哪个方向走（可多选，或选“暂未明确”）</span><small>帮助过滤与你无关的讨论</small></div>
        <div className="chips">
          {GOALS.map((g) => (
            <button key={g.id} type="button" aria-pressed={card.goals.includes(g.id)} className={`chip${card.goals.includes(g.id) ? ' on' : ''}`} onClick={() => toggleGoal(g.id)}>{g.name}</button>
          ))}
        </div>
      </div>

      <label className={`onb-text onb-question${card.confusion.trim() ? ' complete' : ''}`}><span className="onb-label"><span className="onb-index">{card.confusion.trim() ? '✓' : '03'}</span>你现在最想判断什么</span>
        <textarea
          aria-label="你站在哪个路口"
          rows={2}
          placeholder="例如：AIGC 校招到底卷不卷，我这种背景有没有机会"
          value={card.confusion}
          onChange={(e) => set({ confusion: e.target.value })}
          onBlur={finishQuestion}
        />
        <span className="onb-field-note">不用先想出标准答案，这句话会成为本次山径的主问题。</span>
      </label>

      <details className="onb-more" id="onboarding-more">
        <summary><span className="onb-more-title">补充路标</span><span className="onb-optional">可选 · 能提高匹配质量</span></summary>
        <p className="onb-more-hint">先开始也没关系，之后仍可以回来补充这些信息。</p>

        <div className="onb-grid">
          <label>所在山头{usingCustom ? <span className="custom-hint">（下方自定义后以自定义为准）</span> : ''}
            {usingCustom ? (
              <select value="__custom__" disabled>
                <option value="__custom__">已使用自定义山头</option>
              </select>
            ) : (
              <select value={card.industry} onChange={(e) => { set({ industry: e.target.value, sub: INDUSTRIES.find((x) => x.id === e.target.value).subs[0] }); }}>
                {INDUSTRIES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            )}
          </label>
          <label>细分领域{usingCustom ? <span className="custom-hint">（下方自定义后以自定义为准）</span> : ''}
            {usingCustom ? (
              <select value="__custom__" disabled>
                <option value="__custom__">已使用自定义山头</option>
              </select>
            ) : (
              <select value={card.sub} onChange={(e) => set({ sub: e.target.value })}>
                {ind.subs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </label>
        </div>

        <label className="onb-text">
          或直接写下你的山头（写出来就以它为准）
          <input type="text" placeholder="如：半导体 / 心理咨询 / 射频工程师 / 婚恋咨询"
            value={card.customIndustry || ''}
            onChange={(e) => set({ customIndustry: e.target.value })} />
        </label>

        <div className="onb-block">
          <div className="onb-label">想在哪个城市落脚（选填，精确到市）</div>
          <div className="city-select-row">
            <button type="button" className="chip" aria-haspopup="dialog" onClick={() => setCityOpen(true)}>
              {card.city || '+ 选择城市'}
            </button>
            {card.city && <button className="chip ghost" onClick={() => set({ city: '' })}>清除</button>}
          </div>
        </div>

        <label className="onb-text">还有多久必须做决定（选填）
          <input type="text" placeholder="如：3个月内 / 秋招前" value={card.timePressure} onChange={(e) => set({ timePressure: e.target.value })} />
        </label>
      </details>

      {card.resumeExtracted && (
        <div className="resume-note">✓ 已解析简历背景：{card.education.slice(0, 60)}… <button className="link" onClick={() => set({ education: '', resumeExtracted: false })}>清除</button></div>
      )}

      <div className="onb-actions">
        <button className="primary" disabled={!canBuild || !card.confusion.trim()} onClick={() => onBuildCard(card)}>
          开始看真实观点 →
        </button>
        {completedCount < 3
          ? <span className="muted">还差 {3 - completedCount} 项，就可以开始。</span>
          : <span className="onb-ready">路标已齐，下一步会先让你确认，不会立刻检索。</span>}
      </div>

      {history?.topics?.length > 0 && (
        <details className="history">
          <summary>你问过的</summary>
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
