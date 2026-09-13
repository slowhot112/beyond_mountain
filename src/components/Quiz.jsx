import React, { useState, useMemo, useEffect } from 'react';
import { esc, quizFocusRole, canGenerateFullRoute, routeMissingCount } from '../lib.js';

const CONF = [
  { key: 'high', label: '很确定' },
  { key: 'mid', label: '一般' },
  { key: 'low', label: '不确定' },
];

const CUSTOM_SIDE = 'custom';
const CUSTOM_TRIGGER_LABEL = '其他（自己写）';

// 山头调色板：与观点墙一致，选项选中时按所属山头上色
const HILL = ['#2f6fa8', '#4c7a5a', '#8a6a3a', '#7c5cb0', '#0e7490'];
function hillColor(side, roles) {
  const idx = (roles || []).findIndex((r) => r.id === side);
  return HILL[(idx < 0 ? 0 : idx) % HILL.length];
}

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
  const role = roleMap[side] || {};
  return role.stance || role.coreArg || role.name || side;
}

export default function Quiz({ quiz, roles, onAnswer, onProgress, onGotoActions, onNeedHelp, initialProgress = null }) {
  if (!quiz || !quiz.length) return null;
  const [answered, setAnswered] = useState(() => initialProgress?.answers || {});
  const [customDraft, setCustomDraft] = useState({});
  const [editingCustom, setEditingCustom] = useState({});
  const total = quiz.length;
  const answeredCount = Object.keys(answered).length;
  const legacySummary = !initialProgress?.answers && Number(initialProgress?.answeredCount) > 0;
  // 与行动地图的联动门槛：答满 4 题才够格生成完整路线，不足只能看初版
  const missing = routeMissingCount({ answeredCount, total });
  const canGen = canGenerateFullRoute({ answeredCount, total });

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
    if (legacySummary && answeredCount === 0) return;
    onProgress({ sideCounts, uncertainSides, answeredCount, total, dominant, answers: answered });
  }, [sideCounts, uncertainSides, answeredCount, total, dominant, answered, legacySummary, onProgress]);

  function choose(i, opt) {
    const label = typeof opt === 'string' ? opt : opt.label;
    const side = typeof opt === 'string' ? null : opt.side;
    if (side === CUSTOM_SIDE && label === CUSTOM_TRIGGER_LABEL) {
      setEditingCustom((e) => ({ ...e, [i]: true }));
      return;
    }
    setAnswered((a) => ({ ...a, [i]: { ...a[i], label, side } }));
    onAnswer && onAnswer(i, label, side);
    if (!side && /不确定|没想清楚|没头绪/.test(label)) onNeedHelp?.({ index: i, scenario: quiz[i]?.scenario || '' });
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
    if (c === 'low') onNeedHelp?.({ index: i, scenario: quiz[i]?.scenario || '' });
  }

  // 这道题主要对应哪一派（观点墙 → 自测）：让每道题都挂在真实角色上，而不是通用问卷
  function focusRoleOf(q) {
    const id = quizFocusRole(q, roles);
    return id ? (roleMap[id] || null) : null;
  }

  return (
    <section className="card quiz">
      <h2>④ 辨向自测（逼自己站一站）</h2>
      <p className="muted">
        先选你倾向哪一派，再标记你有多确定——如果选项里没有你真正想说的，点「其他」自己写。
        {answeredCount > 0 && <span className="quiz-progress">已答 {answeredCount}/{total}</span>}
        {answeredCount > 0 && missing > 0 && (
          <span className="quiz-progress dim"> · 再答 {missing} 题，雾就散透了，我就能给你指路</span>
        )}
      </p>
      {legacySummary && answeredCount === 0 && (
        <div className="dep-note">
          这是一条旧山径：当时只保存了“偏向与完成度”，没有保存逐题选择。下方可以重新作答；在你选第一题前，原来的路线与摘要不会被覆盖。
        </div>
      )}
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
            <div className="quiz-question">
              <p className="quiz-scenario">{i + 1}. <LongText text={q.scenario} max={140} /></p>
              {focusRoleOf(q) && (
                <div className="quiz-focus">
                  这一题问的是：<b>{esc(focusRoleOf(q).name || focusRoleOf(q).form || '')}</b>
                  {focusRoleOf(q).stance
                    ? <span className="quiz-focus-stance">（{esc(focusRoleOf(q).stance)}）</span>
                    : null}
                </div>
              )}
            </div>
            <div className="quiz-answer">
              <div className="quiz-answer-label">选择一个最接近你的回答</div>
              <div className="quiz-opts quiz-opts-main">
                {displayOptions.filter((opt) => {
                  const side = typeof opt === 'string' ? null : opt.side;
                  return side && side !== CUSTOM_SIDE;
                }).map((opt, j) => {
                  const label = typeof opt === 'string' ? opt : opt.label;
                  const side = typeof opt === 'string' ? null : opt.side;
                  const role = side && side !== CUSTOM_SIDE ? roleMap[side] : null;
                  const isChosen = chosenLabel === label || (side === CUSTOM_SIDE && a?.side === CUSTOM_SIDE);
                  return (
                    <button
                      key={j}
                      type="button"
                      className={`quiz-opt${isChosen ? ' chosen' : ''}`}
                      style={role ? { borderColor: isChosen ? hillColor(side, roles) : 'var(--line)', background: isChosen ? hillColor(side, roles) + '14' : 'var(--paper)' } : null}
                      onClick={() => choose(i, opt)}
                      title={role ? `${role.name || role.stance}` : ''}
                    >
                      {esc(label)}
                      {role && <span className="quiz-opt-side">{esc(role.form || role.name || side)}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="quiz-opts-secondary" aria-label="还没有合适答案">
                {displayOptions.filter((opt) => {
                  const side = typeof opt === 'string' ? null : opt.side;
                  return !side || side === CUSTOM_SIDE;
                }).map((opt, j) => {
                  const label = typeof opt === 'string' ? opt : opt.label;
                  const side = typeof opt === 'string' ? null : opt.side;
                  const isChosen = chosenLabel === label || (side === CUSTOM_SIDE && a?.side === CUSTOM_SIDE);
                  return <button key={j} type="button" className={`quiz-opt-secondary${isChosen ? ' chosen' : ''}`} onClick={() => choose(i, opt)}>{esc(label)}</button>;
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
            </div>
            {a && (
              <div className="quiz-feedback" role="status" aria-live="polite">
                <div className="quiz-feedback-head">
                  <div className="quiz-chosen"><span className="quiz-feedback-label">你的选择</span><b>{esc(chosenLabel)}</b></div>
                  <span className="quiz-feedback-state">已记录，可随时改选</span>
                </div>
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
                      ? '不确定也没关系。刘看山会帮你把这题拆小，你也可以先保留这个答案。'
                      : a.confidence === 'high'
                        ? '很确定？回头看解析时，专门找「和你相反」的那派论据，检验自己是不是只信了一边。'
                        : '一般确定说明你看到了两边道理，继续看解析会帮你把模糊处坐实。'}
                  </div>
                )}
                <div className="quiz-echo"><b>回响</b><span>{esc(q.feedback || '这次选择会进入你的判断画像。')}</span></div>
                <details className="quiz-explanation">
                  <summary>查看这题拆解与观点前提</summary>
                  <div className="quiz-explanation-body">
                    {/* 观点墙 → 自测的联动说明：选了哪一派，就在验证它的哪个论点 / 暴露它的哪个前提 */}
                    {a.side === CUSTOM_SIDE ? (
                      <div className="quiz-link">
                        这是<b>你自己认的路</b>，不在现有几个山头里；我会把它单独留一条，等你去走一趟。
                      </div>
                    ) : (() => {
                      const r = a.side ? roleMap[a.side] : null;
                      if (!r) return null;
                      return (
                        <div className="quiz-link">
                          你选了「{esc(r.name || a.side)}」→ 等于去检验它<b>最硬的那句话</b>：{esc(r.coreArg || r.stance || '')}
                          {r.boundary
                            ? <div className="quiz-premise">它成立的前提：{esc(r.boundary)}。前提要是站不住，这话就得打个折。</div>
                            : null}
                          {a.confidence === 'low'
                            ? <div className="quiz-premise">你标了「不确定」→ 这一派还<b>罩在雾里</b>，下次我陪你先去摸清。</div>
                            : null}
                        </div>
                      );
                    })()}
                    {q.analysis && <div className="quiz-analysis"><b>拆解</b><span>{esc(q.analysis)}</span></div>}
                  </div>
                </details>
              </div>
            )}
          </div>
        );
      })}
      {answeredCount > 0 && (
        <div className="quiz-summary">
          <div>
            {canGen
              ? '雾散了，可以给你指路了。'
              : <>再答 <b>{missing}</b> 题，我才能给你画出下山的路（下面这版只是雾里看山，别拿它下结论）。</>}
          </div>
          {dominant && (
            <div>在本轮题目中，你有 <b>{dominant[1]}/{total}</b> 个选择更接近「{esc(sideDisplayName(roleMap, dominant[0]))}」。这只是当前问题下的答题倾向，建议再看其他观点的成立前提。</div>
          )}
          {uncertainSides.length > 0 ? (
            <div className="quiz-blind">
              你对这些观点还不确定：<b>{uncertainSides.map((s) => esc(sideDisplayName(roleMap, s))).join('、')}</b>。
              可以重看对应观点的论据与成立前提，也可以让刘看山帮你把问题拆小。
            </div>
          ) : (
            <div>你对所有题都给出了确定程度。真正的高手不只站对边，更知道自己哪里可能错——回头把每题「相反立场」的论据也读一遍。</div>
          )}
          {onGotoActions && canGen && (
            <button type="button" className="chip primary quiz-to-actions" onClick={onGotoActions}>
              按我认的方向，画出脚下这条路 →
            </button>
          )}
          {canGen && answeredCount < total && (
            <div className="quiz-partial muted">
              还有 {total - answeredCount} 题没答：你答过的 {answeredCount} 题会算进这条路，没答的那几派我不瞎猜。
            </div>
          )}
        </div>
      )}
    </section>
  );
}
