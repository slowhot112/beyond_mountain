import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  esc, loadActions, saveActions, loadRoad, saveRoad, roadTaskKey, api, personaPayload,
  canGenerateFullRoute, routeConfidence, routeMissingCount, buildActionsPayload, summarizeActionFeedback,
} from '../lib.js';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 把一长串步骤拆成"一句话一行"：兼容 ①②③ / 1. 2. 3. / 第一、第二 等写法
function splitSteps(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const clean = (x) => x.replace(/^[；;，,。.\s]+/, '').replace(/[；;，,]\s*$/, '').trim();
  let parts = s.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/).map(clean).filter(Boolean);
  if (parts.length < 2) parts = s.split(/[；;]\s*(?=\d+\s*[.、)])/).map(clean).filter(Boolean);
  if (parts.length < 2) parts = s.split(/[；;]\s*(?=第[一二三四五六七八九十]+[，,、:：])/).map(clean).filter(Boolean);
  return parts.length > 1 ? parts : [s];
}

// 一张验证任务卡：勾选完成 + 现实回填（属实/打脸/不确定）+ 证据入口
function RmpTask({ task, tkey, st, onToggle, onVerdict, onNote, roleName }) {
  const [showSig, setShowSig] = useState(false);
  const [expanded, setExpanded] = useState(false); // 默认收起：怎么走 / 依据，先露时间 + 要试的判断
  const isDown = st?.verdict === 'down';
  const hasSteps = !!(task.where || task.steps || task.done);
  const hasEv = (task.ev && task.ev.length > 0) || task.evVerify;
  return (
    <li className={['rmp-task', st?.done ? 'done' : '', isDown ? 'down' : '', st?.verdict === 'unclear' ? 'unclear' : ''].filter(Boolean).join(' ')}>
      <div className="rmp-task-head">
        <label className="rmp-check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={!!st?.done} onChange={onToggle} />
          <span>做过</span>
        </label>
        <span className="action-when">⏱ {esc(task.when || '')}</span>
        {task.role && roleName && <span className="rmp-rolechip">{esc(roleName)}</span>}
      </div>
      {task.hypothesis && <div className="rmp-task-hypo">🔍 这一趟要试出：{esc(task.hypothesis)}</div>}

      {hasSteps && (
        <button type="button" className="link-btn rmp-toggle" onClick={() => setExpanded((e) => !e)}>
          {expanded ? '收起怎么走 · 依据 ▲' : '展开怎么走 · 依据 ▼'}
        </button>
      )}
      {expanded && hasSteps && (
        <div className="rmp-task-rows">
          {task.where && <div>📍 往哪儿走：{esc(task.where)}</div>}
          {task.steps && (
            <div>
              🎯 怎么走：
              <div className="rmp-steps">
                {splitSteps(task.steps).map((s, i) => <div key={i} className="rmp-step">{esc(s)}</div>)}
              </div>
            </div>
          )}
          {task.done && <div>📦 走到什么样算过：{esc(task.done)}</div>}
        </div>
      )}
      {expanded && hasEv && (
        <div className="rmp-ev">
          {task.ev && task.ev.length > 0 ? (
            <>
              <span className="rmp-ev-tag">依据（这次翻到的）：</span>
              {task.ev.map((e, i) => (
                e.url
                  ? <a key={i} href={e.url} target="_blank" rel="noreferrer" className="rmp-ev-chip">看来源原文 ↗</a>
                  : <span key={i} className="rmp-ev-chip dim">{esc(e.title)}</span>
              ))}
            </>
          ) : (
            <span>🔎 依据：这一步的答案网上没有，得你自己去问一趟、跑一趟</span>
          )}
        </div>
      )}

      {!showSig && !isDown && (
        <button type="button" className="link-btn" onClick={() => setShowSig(true)}>展开「该坚持 / 该收手」两把尺子</button>
      )}
      {(showSig || isDown) && task.goSignal && <div className="action-go">🟢 该坚持：{esc(task.goSignal)}</div>}
      {(showSig || isDown) && task.stopSignal && <div className="action-stop">🛑 该收手 / 换条路：{esc(task.stopSignal)}</div>}
      <div className="rmp-verdict" onClick={(e) => e.stopPropagation()}>
        <span className="rmp-vlabel">走过这段，回来说一声：</span>
        {[
          { v: 'up', label: '路是通的', cls: 'up' },
          { v: 'down', label: '前面塌方了', cls: 'down' },
          { v: 'unclear', label: '雾还没散', cls: 'unclear' },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            className={['chip', st?.verdict === o.v ? 'active ' + o.cls : ''].filter(Boolean).join(' ')}
            onClick={() => onVerdict(o.v)}
          >
            {o.label}
          </button>
        ))}
        {st?.verdict === 'up' && <span className="rmp-vnote">✓ 你走过的结论：这条路走得通</span>}
        {st?.verdict === 'down' && <span className="rmp-vnote">✗ 你走过的结论：前面塌方了 —— 先想清楚是换条路，还是换个走法</span>}
        {st?.verdict === 'unclear' && <span className="rmp-vnote">雾还没散，别急着下结论</span>}
        {/* 现实反馈（用户自己写）：下次炼金/排路线会读它，用来减少重复验证或建议换路 */}
        <div className="rmp-note" onClick={(e) => e.stopPropagation()}>
          <input
            aria-label="为这段行动留下现实反馈"
            type="text"
            value={st?.note || ''}
            placeholder="回来留个记号（可选）：比如「投了 8 份，一个回复都没有」"
            onChange={(e) => onNote && onNote(e.target.value)}
          />
        </div>
      </div>
    </li>
  );
}

export default function ActionMap({ data, quizResult, persona, prefetchedActions, prevRecord, historyFeedback, onRouteReady, onFeedbackChange }) {
  const [done, setDone] = useState({}); // 旧平铺卡片勾选（回退 UI）
  const [road, setRoad] = useState({}); // 完整路线任务：taskKey -> {done, verdict}
  const [manualRoadmap, setManualRoadmap] = useState(null); // 手动"重做"来的路线
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showLegacySignals, setShowLegacySignals] = useState(false);
  const autoTried = useRef(false);
  const alive = useRef(true);

  const roadmap = manualRoadmap || prefetchedActions?.roadmap || data?.roadmap || null;

  useEffect(() => {
    alive.current = true;
    setDone(loadActions(data));
    setRoad(loadRoad(data));
    setManualRoadmap(null);
    setLoading(false);
    setError(null);
    autoTried.current = false;
    return () => { alive.current = false; };
  }, [data]);

  const roleMap = useMemo(() => {
    const m = {};
    (data?.conflict?.roles || []).forEach((r) => { m[r.id] = r; });
    return m;
  }, [data]);

  // 与辨向自测的衔接：本轮较多选择对应的观点 / 不确定项
  const link = useMemo(() => {
    if (!quizResult || !quizResult.answeredCount) return null;
    const entries = Object.entries(quizResult.sideCounts || {}).sort((a, b) => b[1] - a[1]);
    const top = entries[0] || null;
    const blinds = (quizResult.uncertainSides || [])
      .filter((s) => s !== 'custom')
      .map((s) => roleMap[s]?.stance || roleMap[s]?.coreArg || roleMap[s]?.name || s)
      .filter(Boolean);
    const rawTopName = top ? (roleMap[top[0]]?.stance || roleMap[top[0]]?.coreArg || roleMap[top[0]]?.name || top[0]) : null;
    return {
      topName: rawTopName === 'custom' ? '你自定义的立场' : rawTopName,
      topN: top ? top[1] : 0,
      answered: quizResult.answeredCount,
      blinds,
    };
  }, [quizResult, roleMap]);

  // 决策B「指出变化」：对比上一条带自测结果的历史
  const changeInfo = useMemo(() => {
    if (!prevRecord || !quizResult?.answeredCount) return null;
    const curDomId = quizResult.dominant?.[0];
    if (!curDomId) return null;
    const curRole = roleMap[curDomId] || {};
    const curName = curRole.stance || curRole.coreArg || curRole.name || curDomId;
    const prevQuiz = prevRecord.quiz || {};
    const prevDomId = Array.isArray(prevQuiz.dominant) ? prevQuiz.dominant[0] : (prevQuiz.dominant?.top?.[0]);
    if (!prevDomId) return null;
    const prevRoles = prevRecord.data?.conflict?.roles || [];
    const prevRole = prevRoles.find((r) => r.id === prevDomId) || {};
    const prevName = prevRole.stance || prevRole.coreArg || prevRole.name || prevDomId;
    const ts = prevRecord.ts ? new Date(prevRecord.ts) : null;
    const date = ts ? `${ts.getMonth() + 1}/${ts.getDate()}` : '';
    return { curName, prevName, date, topic: prevRecord.topic, changed: curName !== prevName };
  }, [prevRecord, quizResult, roleMap]);

  // 联动门槛：至少答满 4 题才能生成完整路线；不足门槛只给初版（低置信度），不与完整路线混淆
  const canGen = !!(data && data.conflict?.roles?.length) && canGenerateFullRoute(quizResult);
  const confidence = routeConfidence(quizResult);
  const missing = routeMissingCount(quizResult);

  // 勾选 / 现实裁判 / 反馈文本统一走这里：既写本地，也回传给 App 存进存档（下次炼金能读到）
  function commitRoad(tkey, patch, task) {
    const base = { ...(road[tkey] || {}), ...patch };
    if (task && task.hypothesis) base.hypothesis = task.hypothesis;
    saveRoad(data, tkey, base);
    const next = { ...road, [tkey]: base };
    setRoad(next);
    if (onFeedbackChange) onFeedbackChange(summarizeActionFeedback(next));
  }

  // 进入本模块即请求完整路线（一次）；失败保留初版卡片，可手动再点
  useEffect(() => {
    if (!canGen || roadmap || loading || autoTried.current) return;
    autoTried.current = true;
    requestRoute(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestRoute(manual) {
    if (!canGen || loading) return;
    setLoading(true);
    setError(null);
    try {
      // 本轮已填的行动结果 + 历史各轮的行动结果，一起交给后端：
      // 已验证成立的判断不再重复验证，被现实打脸的方向降优先级 / 建议换路。
      const cur = summarizeActionFeedback(road);
      const hasCur = cur.done > 0 || cur.up.length || cur.down.length || cur.unclear.length || cur.notes.length;
      const feedback = hasCur ? [cur, ...(historyFeedback || [])] : (historyFeedback || []);
      const r = await api('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildActionsPayload({
          data,
          quizResult,
          persona: personaPayload ? personaPayload(persona || {}) : {},
          sources: data.sources || [],
          feedback,
          manual,
        })),
      });
      if (!alive.current) return;
      const rm = r && r.roadmap;
      if (rm && Array.isArray(rm.phases) && rm.phases.length) {
        if (manual) { setManualRoadmap(rm); setRoad({}); }
        if (onRouteReady) onRouteReady(rm);
      } else if (r && r.reason === 'quota') {
        setError('今日直答额度接近上限：已保留初版验证卡片。改天再点「生成完整路线」即可。');
      } else {
        if (manual) setError('生成失败，请稍后重试');
      }
    } catch (e) {
      if (alive.current && manual) setError('生成失败，请检查后端后重试');
    } finally {
      if (alive.current) setLoading(false);
    }
  }

  // ---------------- 路线视图 ----------------
  if (roadmap) {
    return (
      <section className="card actions rmp">
        <h2>⑤ 脚下这条路（有终点 · 先走一步，再下结论）</h2>
        <p className="muted">
          从你「{esc(data?.conflict?.topic || data?.topic || '你的处境')}」出发，到「能下判断 / 能投出去」的一条路。
          每走一步都在试一个判断，回来把你<span className="rmp-hl">真实看到的结果</span>记一笔，这条路会告诉你是继续往上，还是该收手。
          <span className="rmp-live">{loading ? '正在生成中…' : roadmap.horizon ? `全程 ${esc(roadmap.horizon)}` : ''}</span>
        </p>

        {roadmap.generatedAt && (
          <div className="rmp-fresh">📅 依据 {fmtDate(roadmap.generatedAt)} 检索的真实资料整理；投递/决策前请再核一眼最新 JD。</div>
        )}
        {usedHistoryNote(data)}
        {feedbackNote(historyFeedback, summarizeActionFeedback(road))}
        {changeInfo && (
          <div className="action-change">
            {changeInfo.changed
              ? <>两轮答题出现了不同倾向：上一轮更接近「<b>{esc(changeInfo.prevName)}</b>」，本轮更接近「<b>{esc(changeInfo.curName)}</b>」。问题和处境不同也会造成变化，这不代表你更信任某位答主；路线只把它当作一个待验证的新分歧。</>
              : <>本轮较多选择仍接近「<b>{esc(changeInfo.curName)}</b>」。这只反映当前题目下的答题倾向，不代表你认同某位答主；路线会继续验证它成立的前提。</>}
          </div>
        )}

        {error && <div className="dep-note">{esc(error)}</div>}

        {roadmap.goal && roadmap.goal.text && (
          <div className="rmp-goal">
            <div className="rmp-goal-label">🎯 终点卡（你想走到哪）</div>
            <div className="rmp-goal-text">{esc(roadmap.goal.text)}</div>
            {roadmap.goal.basis && <div className="rmp-goal-basis muted">为什么是这个终点：{esc(roadmap.goal.basis)}</div>}
          </div>
        )}

        {link && (
          <div className="action-link">
            接上你的辨向（{link.answered} 题）：
            {link.topName
              ? <>本轮较多选择接近 <b>{esc(link.topName)}</b>，验证这一观点前提的任务已排在前。</>
              : <>多数题标了「不确定」——补盲区、拿一手事实的任务已排在前。</>}
            {link.blinds.length > 0 && <span> 盲区视角：<b>{esc(link.blinds.join('、'))}</b>。</span>}
          </div>
        )}

        {roadmap.phases.map((p, pi) => {
          const tasks = p.tasks || [];
          const hasDown = tasks.some((t, ti) => road[roadTaskKey(pi, ti)]?.verdict === 'down');
          const allDone = tasks.length > 0 && tasks.every((t, ti) => road[roadTaskKey(pi, ti)]?.done);
          const downTask = tasks.find((t, ti) => road[roadTaskKey(pi, ti)]?.verdict === 'down');
          const nextP = roadmap.phases[pi + 1];
          return (
            <div key={pi} className={['rmp-phase', hasDown ? 'hasdown' : '', allDone ? 'phase-done' : ''].filter(Boolean).join(' ')}>
              <h3>
                <span className="rmp-phase-no">第 {p.no || pi + 1} 段</span>
                {p.week && <span className="rmp-phase-week">（{esc(p.week)}）</span>}
              </h3>
              <div className="rmp-phase-goal">🎯 本周目标：{esc(p.title || '')}</div>
              {p.focus && <div className="rmp-phase-focus">📥 学什么 / 查什么：{esc(p.focus)}</div>}
              {hasDown && (
                <div className="rmp-banner stop">
                  🚩 该收手的苗头：{tasks.find((t, ti) => road[roadTaskKey(pi, ti)]?.verdict === 'down')?.hypothesis
                    ? <>任务「{esc(downTask?.hypothesis)}」被现实推翻了。</> : ''}
                  先回看它的「该收手」，再决定是换路还是只换做法。
                </div>
              )}
              {allDone && !hasDown && (
                <div className="rmp-banner ok">
                  ✅ 第 {p.no || pi + 1} 段做完了，且没塌方 —— {nextP ? <>进入下一段：{esc(nextP.title || '')}</> : '你已经走到了自己下的结论。'}
                </div>
              )}
              <ul className="rmp-tasks">
                {tasks.map((t, ti) => {
                  const tkey = roadTaskKey(pi, ti);
                  return (
                    <RmpTask
                      key={tkey}
                      task={t}
                      tkey={tkey}
                      st={road[tkey] || {}}
                      roleName={t.role ? (roleMap[t.role]?.name || t.role) : ''}
                      onToggle={() => {
                        const cur = road[tkey] || {};
                        const nd = !cur.done;
                        const nxt = { done: nd };
                        if (!nd) nxt.verdict = null; // 取消做过 = 清掉回填，避免误判
                        commitRoad(tkey, nxt, t);
                      }}
                      onVerdict={(v) => commitRoad(tkey, { done: true, verdict: v }, t)}
                      onNote={(note) => commitRoad(tkey, { note }, t)}
                    />
                  );
                })}
              </ul>
              {p.phaseDone && <div className="rmp-phasedone">✅ 走到什么样算过：{esc(p.phaseDone)}</div>}
            </div>
          );
        })}

        {roadmap.graduation && (
          <div className="rmp-graduation">
            <h3>🎓 出师清单（走完这条路，最后要交的几样）</h3>
            <ul className="rmp-gcheck">
              {(roadmap.graduation.checklist || []).map((c, ci) => {
                const gkey = 'g' + ci;
                const gst = road[gkey] || {};
                return (
                  <li key={gkey} className={gst.done ? 'done' : ''}>
                    <label className="rmp-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={!!gst.done}
                        onChange={() => {
                          const nd = !gst.done;
                          saveRoad(data, gkey, { done: nd });
                          setRoad((prev) => ({ ...prev, [gkey]: { done: nd } }));
                        }}
                      />
                      <span>{esc(c.text)}</span>
                    </label>
                    {c.verify && <div className="rmp-gverify">拿什么验：{esc(c.verify)}</div>}
                  </li>
                );
              })}
            </ul>
            {roadmap.graduation.judge3 && roadmap.graduation.judge3.length > 0 && (
              <div className="rmp-judge3">
                <div className="rmp-judge3-label">结束时只看这三件事：</div>
                {roadmap.graduation.judge3.map((s, i) => <div key={i}>→ {esc(s)}</div>)}
              </div>
            )}
          </div>
        )}

        <div className="rmp-foot">
          <button type="button" className="chip" disabled={loading} onClick={() => requestRoute(true)}>
            {loading ? '正在重新排你的路线…' : '↻ 再画一条完整的路'}
          </button>
          <span className="muted">每次都会按你最新的判断和当时翻到的真实讨论重画；你插过的旗、记过的事都不会丢。</span>
        </div>
      </section>
    );
  }

  // ---------------- 回退：初版验证卡片（路线未就绪 / 未答自测） ----------------
  const actions = data?.actions || [];
  const total = actions.length;
  const completed = Object.values(done).filter(Boolean).length;
  const dominantId = quizResult?.dominant?.[0];
  const blindIds = quizResult?.uncertainSides || [];

  return (
    <section className="card actions">
      <h2>⑤ 脚下这条路（先走一步看看，再下结论）</h2>
      <p className="muted">
        {canGen
          ? <>正在把你的处境、你刚才偏向哪边、上一轮你走过的结果，和这次翻到的真实讨论，画成一条有终点的路…</>
          : confidence === 'low'
            ? <>再答 <b>{missing}</b> 题（共 4 题），我就能给你画出完整的路；下面是<b>雾里看山的一版</b>，先垫垫脚。</>
            : '先在岔口站一站（至少答 4 题），我才能给你画出属于你的那条路。'}
        {completed > 0 && <span className="action-progress">已插旗 {completed}/{total}</span>}
      </p>

      {usedHistoryNote(data)}
      {feedbackNote(historyFeedback, summarizeActionFeedback(road))}
      {confidence === 'low' && (
        <div className="low-confidence-note">
          ⚠️ <b>雾里看山，先别当真</b>：你才答了 {quizResult?.answeredCount || 0} 题，再答 {missing} 题，我才能看清路，
          下面这版只按你答过的几题粗排，<b>还算不上一条完整的路</b>，先别拿它下结论。
        </div>
      )}
      {changeInfo && (
        <div className="action-change">
          {changeInfo.changed
            ? <>两轮答题出现了不同倾向：上一轮更接近「<b>{esc(changeInfo.prevName)}</b>」，本轮更接近「<b>{esc(changeInfo.curName)}</b>」。这可能来自问题和处境变化，只作为下一步验证线索。</>
            : <>本轮较多选择仍接近「<b>{esc(changeInfo.curName)}</b>」。这只是当前题目下的倾向，下一步会验证它是否适合你的处境。</>}
        </div>
      )}

      {loading && <div className="action-prefetching">正在给你画这条路（约半分钟）：先定终点 → 再分段 → 每一步都配好依据和两把尺子…</div>}
      {error && <div className="dep-note">{esc(error)}</div>}

      {total > 0 ? (
        <>
          <p className="muted">路还没画好，先看这几块垫脚石：每一块都在试一个判断，走过的就插上旗。</p>
          <div className="action-regen">
            <button type="button" className="chip primary" disabled={loading || !canGen} onClick={() => requestRoute(true)}>
              {loading ? '正在排…' : '直接画出完整的路 →'}
            </button>
            <button type="button" className="link-btn" onClick={() => setShowLegacySignals((s) => !s)}>
              {showLegacySignals ? '收起' : '展开'}「该坚持 / 该收手」信号
            </button>
          </div>
          <ul className="action-list">
            {actions.map((a, i) => (
              <li key={i} className={done[i] ? 'done' : ''} onClick={() => {
                const v = !done[i];
                setDone((d) => ({ ...d, [i]: v }));
                saveActions(data, i, v);
              }}>
                <input type="checkbox" readOnly checked={!!done[i]} />
                <div>
                  {a.when && <span className="action-when">⏱ {esc(a.when)}</span>}
                  {dominantId && a.role === dominantId && <span className="action-tag">优先验证本轮较多选择对应的观点</span>}
                  {blindIds.includes(a.role) && <span className="action-tag">补你标了「不确定」的视角</span>}
                  {a.hypothesis && <div className="action-hypo">🔍 要验证：{esc(a.hypothesis)}</div>}
                  {a.where && <div className="action-where">📍 往哪儿走：{esc(a.where)}</div>}
                  {(a.steps || a.action) && (
                    <div className="action-steps">
                      🎯 怎么走：
                      <div className="rmp-steps">
                        {splitSteps(a.steps || a.action).map((s, i) => (
                          <div key={i} className="rmp-step">{esc(s)}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {a.done
                    ? <div className="action-done">📦 做完算成：{esc(a.done)}</div>
                    : a.goSignal && <div className="action-done">✅ 做到什么样算成：{esc(a.goSignal)}</div>}
                  {showLegacySignals && a.goSignal && <div className="action-go">🟢 出现这些说明该坚持：{esc(a.goSignal)}</div>}
                  {showLegacySignals && a.stopSignal && <div className="action-stop">🛑 出现这些说明该收手 / 换路：{esc(a.stopSignal)}</div>}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        !canGen && <div className="dep-note">请先完成【辨向自测】（第 ④ 步），才能排路线。</div>
      )}
    </section>
  );
}

// 上一轮行动结果 → 本轮路线：明确告诉用户"哪些不再重复验证、哪些被降优先级"
function feedbackNote(historyFeedback, cur) {
  const list = Array.isArray(historyFeedback) ? historyFeedback : [];
  const prev = list[0] || null;
  const curDone = (cur && cur.done) || 0;
  const curFilled = cur && (cur.up.length || cur.down.length || cur.unclear.length || cur.notes.length);
  if (!prev && !curDone && !curFilled) return null;
  const lines = [];
  if (prev) {
    const bits = [];
    if (prev.done) bits.push(`走过 ${prev.done} 段`);
    if ((prev.up || []).length) bits.push(`${prev.up.length} 段走得通`);
    if ((prev.down || []).length) bits.push(`${prev.down.length} 段塌了方`);
    if ((prev.unclear || []).length) bits.push(`${prev.unclear.length} 段还罩在雾里`);
    lines.push(
      <div key="prev">
        上一轮「{esc(prev.topic || '同一方向')}」，你{bits.join('、')}：
        这轮<b>不再让你重走已经走通的那段</b>
        {(prev.down || []).length ? <>，<b>塌方那段给你绕开，必要时换条路走</b></> : null}
        {(prev.unclear || []).length ? <>，<b>还在雾里的那段，继续去摸清</b></> : null}
        。
      </div>,
    );
  }
  if (curDone || curFilled) {
    lines.push(<div key="cur">这轮你已经走过 {curDone} 段，点「再画一条」时，我会连你记下的这些一起重算。</div>);
  }
  return <div className="rmp-feedback">🔁 你上次走过的路，这次都算进来了：{lines}</div>;
}

function usedHistoryNote(data) {
  const usedHistory = data?.usedHistory || [];
  if (!usedHistory.length) return null;
  const topics = usedHistory.filter(Boolean).slice(0, 3);
  return (
    <div className="action-history">
      本次路线参考了你过去的 {usedHistory.length} 条山径记录
      {topics.length ? `：${topics.join('、')}${usedHistory.length > topics.length ? '等' : ''}` : '。'}
    </div>
  );
}
