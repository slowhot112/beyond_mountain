import React, { useState, useMemo, useEffect } from 'react';
import { esc } from '../lib.js';

const CONF = [
  { key: 'high', label: '很确定' },
  { key: 'mid', label: '一般' },
  { key: 'low', label: '不确定' },
];

const CUSTOM_SIDE = 'custom';
const CUSTOM_TRIGGER_LABEL = '其他（自己写）';

// 题干默认只给前 max 字，避免整段原文堆在题目里
function LongText({ text, max = 140 }) {
  const [open, setOpen] = useState(false);
  const t = String(text || '');
  if (t.length <= max) return <>{esc(t)}</>;
  return (
    <span className="long-text">
      {open ? esc(t) : `${esc(t.slice(0, max))}…`}
      <button
        type="button"
        className="link-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >{open ? '收起' : '展开原文'}</button>
    </span>
  );
}

function sideDisplayName(roleMap, side) {
  if (!side) return '';
  if (side === CUSTOM_SIDE) return '你自定义的立场';
  return roleMap[side]?.name || side;
}

export default function Quiz({ quiz, roles, onAnswer, onProgress, onGotoActions }) {
  if (!quiz || !quiz.length) return null;
  const [answered, setAnswered] = useState({});
  const [customDraft, setCustomDraft] = useState({});
  const [editingCustom, setEditingCustom] = useState({});
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

  // 把当次自测结果实时上报，供行动地图衔接使用
  useEffect(() => {
    if (!onProgress) return;
    onProgress({ sideCounts, uncertainSides, answeredCount, total, dominant });
  }, [sideCounts, uncertainSides, answeredCount, total, dominant, onProgress]);

  function choose(i, opt) {
    const label = typeof opt === 'string' ? opt : opt.label;
    const side = typeof opt === 'string' ? null : opt.side;
    if (side === CUSTOM_SIDE && label === CUSTOM_TRIGGER_LABEL) {
      setEditingCustom((e) => ({ ...e, [i]: true }));
      return;
    }
    setAnswered((a) => ({ ...a, [i]: { ...a[i], label, side } }));
    onAnswer && onAnswer(i, label, side);
  }

  function confirmCustom(i) {
    const text = (customDraft[i] || '').trim();
    if (!text) return;
    setAnswered((a) => ({ ...a, [i]: { ...a[i], label: text, side: CUSTOM_SIDE } }));
    onAnswer && onAnswer(i, text, CUSTOM_SIDE);
    setEditingCustom((e) => ({ ...e, [i]: false }));
  }

  function setConfidence(i, c) {
    setAnswered((a) => ({ ...a, [i]: { ...a[i], confidence: c } }));
  }

  return (
    <section className="card quiz">
      <h2>③ 判断力自测（魔鬼辩驳）</h2>
      <p className="muted">
        先选你的立场，再标记你有多确定——如果选项里没有你真正想说的，点「其他」自己写。
        {answeredCount > 0 && <span className="quiz-progress">已答 {answeredCount}/{total}</span>}
      </p>
      {quiz.map((q, i) => {
        const a = answered[i];
        const chosenLabel = a?.label;
        const isEditingCustom = editingCustom[i];
        const displayOptions = [
          ...(q.options || []),
          { label: CUSTOM_TRIGGER_LABEL, side: CUSTOM_SIDE },
        ];
        return (
          <div key={i} className="quiz-item">
            <p className="quiz-scenario">{i + 1}. <LongText text={q.scenario} max={140} /></p>
            <div className="quiz-opts">
              {displayOptions.map((opt, j) => {
                const label = typeof opt === 'string' ? opt : opt.label;
                const side = typeof opt === 'string' ? null : opt.side;
                const role = side && side !== CUSTOM_SIDE ? roleMap[side] : null;
                const isChosen = chosenLabel === label || (side === CUSTOM_SIDE && a?.side === CUSTOM_SIDE);
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
            {isEditingCustom && (
              <div className="quiz-custom-input">
                <input
                  type="text"
                  value={customDraft[i] || ''}
                  onChange={(e) => setCustomDraft((d) => ({ ...d, [i]: e.target.value }))}
                  placeholder="写下你的立场，例如：我想先实习再决定"
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmCustom(i); }}
                />
                <button type="button" className="chip" onClick={() => confirmCustom(i)}>确定</button>
              </div>
            )}
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
            <div>立场分布：你目前更偏向 <b>{esc(sideDisplayName(roleMap, dominant[0]))}</b>（{dominant[1]}/{total} 题）。三派并非非此即彼，建议补另外两派视角。</div>
          )}
          {uncertainSides.length > 0 ? (
            <div className="quiz-blind">
              认知盲区：你在 <b>{uncertainSides.map((s) => esc(sideDisplayName(roleMap, s))).join('、')}</b> 上选择了「不确定」。
              这些就是你现在最该补的判断维度——重看对应派的「核心论点」和「边界」，比刷题更能长判断力。
            </div>
          ) : (
            <div>你对所有题都给出了确定程度。真正的高手不只站对边，更知道自己哪里可能错——回头把每题「相反立场」的论据也读一遍。</div>
          )}
          {onGotoActions && (
            <button type="button" className="chip primary quiz-to-actions" onClick={onGotoActions}>
              按我的自测结果生成行动地图 →
            </button>
          )}
        </div>
      )}
    </section>
  );
}
