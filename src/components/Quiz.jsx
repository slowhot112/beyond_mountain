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

// 实时显示当前选择会如何影响后面的行动地图排序
function QuizImpact({ sideCounts, uncertainSides, dominant, roleMap, total }) {
  const hasAny = Object.keys(sideCounts || {}).length > 0;
  if (!hasAny) {
    return <div className="quiz-impact">选完立场后，这里会实时显示它如何影响后面的验证路线。</div>;
  }
  const domName = dominant ? sideDisplayName(roleMap, dominant[0]) : '';
  const blind = (uncertainSides || [])
    .map((s) => sideDisplayName(roleMap, s))
    .filter(Boolean);
  return (
    <div className="quiz-impact">
      <div className="qi-title">这一步对「脚下三步」的影响</div>
      {dominant && (
        <div className="qi-line">
          当前最信 <b>{esc(domName)}</b>（{dominant[1]}/{total} 题）→ 验证路线会优先检验这一派站不站得住。
        </div>
      )}
      {blind.length > 0 ? (
        <div className="qi-line">
          当前盲区 <b>{esc(blind.join('、'))}</b> → 会优先安排补看这些视角的论据和前提。
        </div>
      ) : (
        <div className="qi-line">还没标任何「不确定」的盲区，全部答完后再回头扫一遍反方论据会更稳。</div>
      )}
    </div>
  );
}

// 选项文字净化：剥掉「该答主认为/分享」这类转述前缀，避免选项读起来像文章开场白而不是一个可选择的判断
function cleanLabel(s) {
  let t = String(s || '').trim();
  t = t.replace(/^(?:该答主认为|该答主分享|该答主觉得|答主认为|答主觉得|答主分享|其中一方认为|另一方认为|有人认为|有答主认为|ta认为|ta觉得|知乎答主认为|高赞答主认为)[：:]?\s*/g, '');
  if (t.length > 46) t = `${t.slice(0, 46)}…`;
  return t;
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
      <h2>③ 辨向自测（标出你最信 / 没把握的派）</h2>
      <p className="muted">
        5 道题不是考试，是让你给三派打标签：哪派你更信、哪派你还没看清。
        这些标签会直接决定后面「脚下三步」的排序——先验证你最信的，再补你没把握的。
        {answeredCount > 0 && <span className="quiz-progress">已答 {answeredCount}/{total}</span>}
      </p>
      {quiz.map((q, i) => {
        const a = answered[i];
        const chosenLabel = a?.label;
        const isEditingCustom = editingCustom[i];
        const aSideName = a?.side
          ? (a.side === CUSTOM_SIDE ? '你自定义的立场' : (roleMap[a.side]?.name || a.side))
          : '';
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
                    title={role ? `${role.name || role.form || side}：${cleanLabel(label)}` : esc(label)}
                  >
                    {esc(cleanLabel(label))}
                    {role && (
                      <span className="quiz-opt-side">
                        {esc(role.name || role.form || side)}
                        {role.form && <span className="quiz-opt-src">{esc(role.form)}</span>}
                      </span>
                    )}
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
                <div className="quiz-chosen">
                  你选了 <b>“{esc(cleanLabel(chosenLabel))}”</b> 这派
                  {aSideName && <span className="quiz-chosen-side">（{esc(aSideName)}）</span>}
                </div>
                <div className="quiz-confidence">
                  <span className="lbl">有几分把握？</span>
                  {CONF.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className={`quiz-conf-btn${a.confidence === c.key ? ' chosen' : ''}`}
                      onClick={() => setConfidence(i, c.key)}
                    >{c.label}</button>
                  ))}
                </div>
                {!a.confidence && (
                  <div className="quiz-conf-hint">选「不确定」的派会记成你的盲区，后面会优先安排补看。</div>
                )}
                {a.confidence && (
                  <div className="quiz-conf-note">
                    {a.confidence === 'low'
                      ? '不确定也没关系——这恰好是一片你还没看清的岔口，正是该补的盲区。'
                      : a.confidence === 'high'
                        ? '很确定？回头看解析时，专门找「和你相反」的那派论据，检验自己是不是只信了一边。'
                        : '一般确定说明你看到了两边道理，继续看解析会帮你把模糊处坐实。'}
                  </div>
                )}
                <QuizImpact
                  sideCounts={sideCounts}
                  uncertainSides={uncertainSides}
                  dominant={dominant}
                  roleMap={roleMap}
                  total={total}
                />
                <div><b>回响：</b>{esc(q.feedback)}</div>
                {q.analysis && <div className="quiz-analysis"><b>拆解：</b>{esc(q.analysis)}</div>}
              </div>
            )}
          </div>
        );
      })}
      {answeredCount === total && (
        <div className="quiz-summary">
          <div>辨向完成。</div>
          {dominant && (
            <div>你目前的偏向：<b>{esc(sideDisplayName(roleMap, dominant[0]))}</b>（{dominant[1]}/{total} 题）。这一选择已生效——「脚下三步」会把验证你偏信这一派是否站得住的路线排在最前，你偏的派先被检验，而不是替你拍板。三派并非非此即彼，也建议补另外两派视角。</div>
          )}
          {uncertainSides.length > 0 ? (
            <div className="quiz-blind">
              还没看清的岔口：你在 <b>{uncertainSides.map((s) => esc(sideDisplayName(roleMap, s))).join('、')}</b> 上选择了「不确定」。
              这些就是你现在最该补的判断维度——重看对应山头的「最硬论据」和「前提」，比刷题更能长判断力。
            </div>
          ) : (
            <div>你对所有题都给出了确定程度。真正的高手不只站对边，更知道自己哪里可能错——回头把每题「相反立场」的论据也读一遍。</div>
          )}
          {onGotoActions && (
            <button type="button" className="chip primary quiz-to-actions" onClick={onGotoActions}>
              按我的辨向结果生成脚下三步 →
            </button>
          )}
        </div>
      )}
    </section>
  );
}
