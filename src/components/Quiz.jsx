import React, { useState, useMemo } from 'react';
import { esc } from '../lib.js';

const CONF = [
  { key: 'high', label: '很确定' },
  { key: 'mid', label: '一般' },
  { key: 'low', label: '不确定' },
];

export default function Quiz({ quiz, roles, onAnswer }) {
  if (!quiz || !quiz.length) return null;
  const [answered, setAnswered] = useState({});
  const total = quiz.length;
  const answeredCount = Object.keys(answered).length;

  const roleMap = useMemo(() => {
    const map = {};
    (roles || []).forEach((r) => { map[r.id] = r; });
    return map;
  }, [roles]);

  // 立场分布：用户每题更偏向哪一派
  const sideCounts = useMemo(() => {
    const counts = {};
    Object.values(answered).forEach((a) => {
      const side = a?.side;
      if (side) counts[side] = (counts[side] || 0) + 1;
    });
    return counts;
  }, [answered]);

  const dominant = useMemo(() => {
    const entries = Object.entries(sideCounts);
    if (!entries.length) return null;
    return entries.reduce((max, cur) => (cur[1] > max[1] ? cur : max));
  }, [sideCounts]);

  // 自信分布：哪些题选了「不确定」→ 对应派即当前认知盲区
  const uncertainSides = useMemo(() => {
    const set = new Set();
    Object.values(answered).forEach((a) => {
      if (a && a.confidence === 'low' && a.side) set.add(a.side);
    });
    return [...set];
  }, [answered]);

  function choose(i, opt) {
    const v = typeof opt === 'string' ? opt : opt.label;
    const side = typeof opt === 'string' ? null : opt.side;
    setAnswered((a) => ({ ...a, [i]: { ...a[i], label: v, side } }));
    onAnswer && onAnswer(i, v, side);
  }

  function setConfidence(i, c) {
    setAnswered((a) => ({ ...a, [i]: { ...a[i], confidence: c } }));
  }

  return (
    <section className="card quiz">
      <h2>③ 判断力自测（魔鬼辩驳）</h2>
      <p className="muted">
        先选你的立场，再标记你有多确定——别急着看答案，先逼自己判断。
        {answeredCount > 0 && <span className="quiz-progress">已答 {answeredCount}/{total}</span>}
      </p>
      {quiz.map((q, i) => {
        const a = answered[i];
        const chosenLabel = a?.label;
        return (
          <div key={i} className="quiz-item">
            <p className="quiz-scenario">{i + 1}. {esc(q.scenario)}</p>
            <div className="quiz-opts">
              {q.options.map((opt, j) => {
                const label = typeof opt === 'string' ? opt : opt.label;
                const side = typeof opt === 'string' ? null : opt.side;
                const role = side ? roleMap[side] : null;
                const isChosen = chosenLabel === label;
                return (
                  <button
                    key={j}
                    type="button"
                    className={`quiz-opt${isChosen ? ' chosen' : ''}`}
                    onClick={() => choose(i, opt)}
                    title={role ? `${role.name || role.stance}` : ''}
                  >
                    {esc(label)}
                    {role && <span className="quiz-opt-side">{esc(role.name || role.stance || side)}</span>}
                  </button>
                );
              })}
            </div>
            {a && (
              <div className="quiz-feedback">
                <div className="quiz-chosen">你选了：<b>{esc(chosenLabel)}</b></div>
                <div className="quiz-confidence">
                  <span className="lbl">你有多确定？</span>
                  {CONF.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className={`quiz-conf-btn${a.confidence === c.key ? ' chosen' : ''}`}
                      onClick={() => setConfidence(i, c.key)}
                    >{c.label}</button>
                  ))}
                </div>
                {a.confidence && (
                  <div className="quiz-conf-note">
                    {a.confidence === 'low'
                      ? '不确定也没关系——这恰好说明这一派你还没形成判断，正是该补的盲区。'
                      : a.confidence === 'high'
                        ? '很确定？回头看解析时，专门找「和你相反」的那派论据，检验自己是不是只信了一边。'
                        : '一般确定说明你看到了两边道理，继续看解析会帮你把模糊处坐实。'}
                  </div>
                )}
                <div><b>反馈：</b>{esc(q.feedback)}</div>
                {q.analysis && <div className="quiz-analysis"><b>解析：</b>{esc(q.analysis)}</div>}
              </div>
            )}
          </div>
        );
      })}
      {answeredCount === total && (
        <div className="quiz-summary">
          <div>自测完成。</div>
          {dominant && (
            <div>立场分布：你目前更偏向 <b>{esc(roleMap[dominant[0]]?.name || dominant[0])}</b>（{dominant[1]}/{total} 题）。三派并非非此即彼，建议补另外两派视角。</div>
          )}
          {uncertainSides.length > 0 ? (
            <div className="quiz-blind">
              认知盲区：你在 <b>{uncertainSides.map((s) => esc(roleMap[s]?.name || s)).join('、')}</b> 上选择了「不确定」。
              这些就是你现在最该补的判断维度——重看对应派的「核心论点」和「边界」，比刷题更能长判断力。
            </div>
          ) : (
            <div>你对所有题都给出了确定程度。真正的高手不只站对边，更知道自己哪里可能错——回头把每题「相反立场」的论据也读一遍。</div>
          )}
        </div>
      )}
    </section>
  );
}
