import React, { useState, useEffect, useMemo, useRef } from 'react';
import { esc, loadActions, saveActions, loadRoad, saveRoad, roadTaskKey, api, personaPayload } from '../lib.js';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 一张验证任务卡：勾选完成 + 现实回填（属实/打脸/不确定）+ 证据入口
function RmpTask({ task, tkey, st, onToggle, onVerdict, roleName }) {
  const [showSig, setShowSig] = useState(false);
  const isDown = st?.verdict === 'down';
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
      {task.hypothesis && <div className="rmp-task-hypo">🔍 验证：{esc(task.hypothesis)}</div>}
      <div className="rmp-task-rows">
        {task.where && <div>📍 去哪儿：{esc(task.where)}</div>}
        {task.steps && <div>🎯 怎么做：{esc(task.steps)}</div>}
        {task.done && <div>📦 做完算成：{esc(task.done)}</div>}
      </div>
      {!showSig && !isDown && (
        <button type="button" className="link-btn" onClick={() => setShowSig(true)}>展开「该坚持 / 该收手」两把尺子</button>
      )}
      {(showSig || isDown) && task.goSignal && <div className="action-go">🟢 该坚持：{esc(task.goSignal)}</div>}
      {(showSig || isDown) && task.stopSignal && <div className="action-stop">🛑 该收手 / 换路：{esc(task.stopSignal)}</div>}
      {(task.ev && task.ev.length > 0) && (
        <div className="rmp-ev">
          <span className="rmp-ev-tag">依据（本次检索）：</span>
          {task.ev.map((e, i) => (
            e.url
              ? <a key={i} href={e.url} target="_blank" rel="noreferrer" className="rmp-ev-chip">看来源原文 ↗</a>
              : <span key={i} className="rmp-ev-chip dim">{esc(e.title)}</span>
          ))}
        </div>
      )}
      {task.evVerify && !(task.ev && task.ev.length > 0) && (
        <div className="rmp-ev">🔎 依据：这步主要靠你去拿一手事实（不依赖网络资料，跑完就有答案）</div>
      )}
      <div className="rmp-verdict" onClick={(e) => e.stopPropagation()}>
        <span className="rmp-vlabel">做完回来告诉我结果：</span>
        {[
          { v: 'up', label: '属实 · 站得住', cls: 'up' },
          { v: 'down', label: '打脸 · 被推翻', cls: 'down' },
          { v: 'unclear', label: '还不确定', cls: 'unclear' },
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
        {st?.verdict === 'up' && <span className="rmp-vnote">✓ 这条的现实裁判：站得住</span>}
        {st?.verdict === 'down' && <span className="rmp-vnote">✗ 这条的现实裁判：打脸 —— 先想清楚是换路还是换做法</span>}
        {st?.verdict === 'unclear' && <span className="rmp-vnote">这条证据还不够，别急着下结论</span>}
      </div>
    </li>
  );
}

export default function ActionMap({ data, quizResult, persona, prefetchedActions, prevRecord, onRouteReady }) {
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

  // 与辨向自测的衔接：最信派 / 盲区
  const link = useMemo(() => {
    if (!quizResult || !quizResult.answeredCount) return null;
    const entries = Object.entries(quizResult.sideCounts || {}).sort((a, b) => b[1] - a[1]);
    const top = entries[0] || null;
    const blinds = (quizResult.uncertainSides || [])
      .filter((s) => s !== 'custom')
      .map((s) => roleMap[s]?.name || s)
      .filter(Boolean);
    const rawTopName = top ? (roleMap[top[0]]?.name || top[0]) : null;
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
    const curName = roleMap[curDomId]?.name || curDomId;
    const prevQuiz = prevRecord.quiz || {};
    const prevDomId = Array.isArray(prevQuiz.dominant) ? prevQuiz.dominant[0] : (prevQuiz.dominant?.top?.[0]);
    if (!prevDomId) return null;
    const prevRoles = prevRecord.data?.conflict?.roles || [];
    const prevName = prevRoles.find((r) => r.id === prevDomId)?.name || prevDomId;
    const ts = prevRecord.ts ? new Date(prevRecord.ts) : null;
    const date = ts ? `${ts.getMonth() + 1}/${ts.getDate()}` : '';
    return { curName, prevName, date, topic: prevRecord.topic, changed: curName !== prevName };
  }, [prevRecord, quizResult, roleMap]);

  const canGen = !!(quizResult && quizResult.answeredCount && data && data.conflict?.roles?.length);

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
      const r = await api('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: data.topic || '',
          roles: data.conflict.roles,
          quizResult,
          persona: personaPayload ? personaPayload(persona || {}) : {},
          sources: (data.sources || []).slice(0, 8),
          auto: !manual,
        }),
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
        <h2>④ 决策验证路线（带终点 · 先验证，再下结论）</h2>
        <p className="muted">
          从你「{esc(data?.conflict?.topic || data?.topic || '你的处境')}」出发，到「能下判断 / 能投出去」的一条路。
          每步都在验证一个判断，做完回来用<span className="rmp-hl">现实结果</span>打勾，路线会自动告诉你是该加码还是该收手。
          <span className="rmp-live">{loading ? '正在生成中…' : roadmap.horizon ? `全程 ${esc(roadmap.horizon)}` : ''}</span>
        </p>

        {roadmap.generatedAt && (
          <div className="rmp-fresh">📅 依据 {fmtDate(roadmap.generatedAt)} 检索的真实资料整理；投递/决策前请再核一眼最新 JD。</div>
        )}
        {usedHistoryNote(data)}
        {changeInfo && (
          <div className="action-change">
            {changeInfo.changed
              ? <>相比上次，你最信的立场从「<b>{esc(changeInfo.prevName)}</b>」变到了「<b>{esc(changeInfo.curName)}</b>」——这版路线会重点验证你现在最信的这一派。</>
              : <>和上次一样，你最信的仍是「<b>{esc(changeInfo.curName)}</b>」，这版路线重点验证它是否真站得住。</>}
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
              ? <>你更偏向 <b>{esc(link.topName)}</b>——验证这一派的任务已排在前。</>
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
                ：{esc(p.title || '')}
              </h3>
              {p.focus && <div className="rmp-phase-focus">这一段要办成：{esc(p.focus)}</div>}
              {hasDown && (
                <div className="rmp-banner stop">
                  🚩 出现收手信号：{tasks.find((t, ti) => road[roadTaskKey(pi, ti)]?.verdict === 'down')?.hypothesis
                    ? <>任务「{esc(downTask?.hypothesis)}」被现实打脸了。</> : ''}
                  先回看它的「该收手」，再决定是换路还是只换做法。
                </div>
              )}
              {allDone && !hasDown && (
                <div className="rmp-banner ok">
                  ✅ 第 {p.no || pi + 1} 段做完了，且没有被打脸 —— {nextP ? <>进入下一段：{esc(nextP.title || '')}</> : '你已经走到了自己下的结论。'}
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
                        saveRoad(data, tkey, nxt);
                        setRoad((prev) => ({ ...prev, [tkey]: { ...(prev[tkey] || {}), ...nxt } }));
                      }}
                      onVerdict={(v) => {
                        const nxt = { done: true, verdict: v };
                        saveRoad(data, tkey, nxt);
                        setRoad((prev) => ({ ...prev, [tkey]: { ...(prev[tkey] || {}), ...nxt } }));
                      }}
                    />
                  );
                })}
              </ul>
              {p.phaseDone && <div className="rmp-phasedone">做到什么算过：{esc(p.phaseDone)}</div>}
            </div>
          );
        })}

        {roadmap.graduation && (
          <div className="rmp-graduation">
            <h3>🎓 毕业检查表（走完这条路的最后几步）</h3>
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
            {loading ? '正在重新排你的路线…' : '↻ 重做一份完整路线'}
          </button>
          <span className="muted">每次都会结合你最新的辨向和当时的真实资料重排；你的勾选与回填不会丢。</span>
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
      <h2>④ 决策验证路线（先验证判断，再下结论）</h2>
      <p className="muted">
        {canGen
          ? <>正在把你的处境 + 自测偏向 + 本次搜到的真实资料，排成一张「带终点」的完整路线…</>
          : '先完成【辨向自测】，才能排出一张属于你的路线。'}
        {completed > 0 && <span className="action-progress">已完成 {completed}/{total}</span>}
      </p>

      {usedHistoryNote(data)}
      {changeInfo && (
        <div className="action-change">
          {changeInfo.changed
            ? <>相比上次，你最信的立场从「<b>{esc(changeInfo.prevName)}</b>」变到了「<b>{esc(changeInfo.curName)}</b>」。</>
            : <>和上次一样，你最信的仍是「<b>{esc(changeInfo.curName)}</b>」，这次重点验证它是否真站得住。</>}
        </div>
      )}

      {loading && <div className="action-prefetching">正在为你排完整路线（约半分钟）：终点卡 → 带周次的阶段 → 每步的证据与两把尺子…</div>}
      {error && <div className="dep-note">{esc(error)}</div>}

      {total > 0 ? (
        <>
          <p className="muted">路线生成前，可先看初版验证卡片垫一垫：每条都在验证一个判断，勾掉已做的。</p>
          <div className="action-regen">
            <button type="button" className="chip primary" disabled={loading || !canGen} onClick={() => requestRoute(true)}>
              {loading ? '正在排…' : '直接生成完整路线 →'}
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
                  {dominantId && a.role === dominantId && <span className="action-tag">先验证你最信的「{esc(roleMap[dominantId]?.name || dominantId)}」</span>}
                  {blindIds.includes(a.role) && <span className="action-tag">补你标了「不确定」的视角</span>}
                  {a.hypothesis && <div className="action-hypo">🔍 要验证：{esc(a.hypothesis)}</div>}
                  {a.where && <div className="action-where">📍 去哪儿：{esc(a.where)}</div>}
                  {a.steps && <div className="action-steps">🎯 怎么做：{esc(a.steps)}</div>}
                  {a.done && <div className="action-done">📦 做完算成：{esc(a.done)}</div>}
                  {showLegacySignals && a.goSignal && <div className="action-go">🟢 出现这些说明该坚持：{esc(a.goSignal)}</div>}
                  {showLegacySignals && a.stopSignal && <div className="action-stop">🛑 出现这些说明该收手 / 换路：{esc(a.stopSignal)}</div>}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        !canGen && <div className="dep-note">请先完成【辨向自测】（第 ③ 步），才能排路线。</div>
      )}
    </section>
  );
}

function usedHistoryNote(data) {
  const usedHistory = data?.usedHistory || [];
  if (!usedHistory.length) return null;
  return (
    <div className="action-history">📚 本次参考了你 {usedHistory.length} 条历史炼金包（已自动避开无关话题，不会串味）</div>
  );
}
