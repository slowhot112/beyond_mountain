import React, { useState, useEffect, useMemo } from 'react';
import { esc, loadActions, saveActions } from '../lib.js';

export default function ActionMap({ data, quizResult }) {
  const [done, setDone] = useState({});

  useEffect(() => {
    setDone(loadActions(data));
  }, [data]);

  const roleMap = useMemo(() => {
    const map = {};
    (data?.conflict?.roles || []).forEach((r) => { map[r.id] = r; });
    return map;
  }, [data]);

  // 与判断力自测的衔接：用当次自测的立场分布 / 盲区，给出优先做什么
  const link = useMemo(() => {
    if (!quizResult || !quizResult.answeredCount) return null;
    const entries = Object.entries(quizResult.sideCounts || {}).sort((a, b) => b[1] - a[1]);
    const top = entries[0] || null;
    const blinds = (quizResult.uncertainSides || [])
      .filter((s) => s !== 'custom')
      .map((s) => roleMap[s]?.name || (s === 'custom' ? '你自定义的立场' : s))
      .filter(Boolean);
    const rawTopName = top ? (roleMap[top[0]]?.name || top[0]) : null;
    return {
      topName: rawTopName === 'custom' ? '你自定义的立场' : rawTopName,
      topN: top ? top[1] : 0,
      answered: quizResult.answeredCount,
      blinds,
    };
  }, [quizResult, roleMap]);

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
      {link && (
        <div className="action-link">
          接上你刚做完的自测（{link.answered} 题）：
          {link.topName
            ? <>你更偏向 <b>{esc(link.topName)}</b>（{link.topN} 题）。先做下面第 1 条去验证你最信的这一派，再看第 2 条补相反视角。</>
            : <>你还没给出明确的立场倾向（多数题选了「不确定」），先做下面第 1 条拿一手事实，别急着站队。</>}
          {link.blinds.length > 0 && (
            <div className="action-link-blind">
              你在 <b>{esc(link.blinds.join('、'))}</b> 上标了「不确定」：这是你最该补的判断维度，做第 2 条时专门找这类视角的信息。
            </div>
          )}
        </div>
      )}
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
