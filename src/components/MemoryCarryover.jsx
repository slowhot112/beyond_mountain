import React, { useEffect, useState } from 'react';
import { esc } from '../lib.js';

export default function MemoryCarryover({ candidates = [], decision, onDecision }) {
  const [selected, setSelected] = useState(() => candidates.map((item) => item.id));
  useEffect(() => { setSelected(candidates.map((item) => item.id)); }, [candidates.map((item) => item.id).join('|')]);
  if (!candidates.length) return null;
  const resolved = decision !== null;
  function toggle(id) {
    setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }
  return (
    <section className="memory-carryover" aria-labelledby="memory-carryover-title">
      <div className="memory-carryover-head">
        <div><span>行动簿发现相近处境</span><h2 id="memory-carryover-title">这些旧判断要带进这次吗？</h2></div>
        {resolved && <button type="button" className="link-btn" onClick={() => onDecision(null)}>重新选择</button>}
      </div>
      <p>旧判断默认不会自动套用。下面说明了相同和不同条件，只有你确认后才会成为这次的参考前提。</p>
      <div className="memory-candidate-list">
        {candidates.map((item) => (
          <label key={item.id} className={selected.includes(item.id) ? 'selected' : ''}>
            <input type="checkbox" disabled={resolved} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
            <span className="memory-check" aria-hidden="true">{selected.includes(item.id) ? '✓' : ''}</span>
            <span className="memory-candidate-copy">
              <b>{esc(item.title)}</b>
              <span>相近：{item.matches.join('、')}</span>
              <span className={item.differences.length ? 'different' : ''}>{item.differences.length ? `不同：${item.differences.join('、')}，因此只能作为参考` : '已填写的关键条件没有冲突'}</span>
            </span>
          </label>
        ))}
      </div>
      {!resolved ? <div className="memory-carryover-actions"><button type="button" className="primary" disabled={!selected.length} onClick={() => onDecision(selected)}>带入选中的判断</button><button type="button" className="chip ghost" onClick={() => onDecision([])}>这次先不带入</button></div> : <div className="memory-carryover-result" role="status">{decision.length ? `已选择 ${decision.length} 条，只用于提醒需要重新核对的前提，不会替你作答。` : '这次不带入旧判断，行动簿中的历史记录不会被删除。'}</div>}
    </section>
  );
}
