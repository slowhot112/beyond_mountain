import React, { useState, useEffect } from 'react';
import { esc, loadActions, saveActions } from '../lib.js';

export default function ActionMap({ data }) {
  const [done, setDone] = useState({});

  useEffect(() => {
    setDone(loadActions(data));
  }, [data]);

  function toggle(i) {
    const v = !done[i];
    setDone((d) => ({ ...d, [i]: v }));
    saveActions(data, i, v);
  }

  if (!data.actions || !data.actions.length) return null;
  const total = data.actions.length;
  const completed = Object.values(done).filter(Boolean).length;

  return (
    <section className="card actions">
      <h2>④ 行动地图（先求小赢，不求大翻盘）</h2>
      <p className="muted">勾掉你能做的，剩下的再想。{completed > 0 && <span className="action-progress">已完成 {completed}/{total}</span>}</p>
      <ul className="action-list">
        {data.actions.map((a, i) => (
          <li key={i} className={done[i] ? 'done' : ''} onClick={() => toggle(i)}>
            <input type="checkbox" readOnly checked={!!done[i]} />
            <div>
              <div className="action-task">{esc(a.task)}</div>
              <div className="action-why">{esc(a.why)}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
