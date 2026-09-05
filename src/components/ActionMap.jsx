import React, { useState, useEffect, useMemo, useRef } from 'react';
import { esc, loadActions, saveActions, api, personaPayload } from '../lib.js';

export default function ActionMap({ data, quizResult, persona, prefetchedActions, prefetching, prevRecord }) {
  const [done, setDone] = useState({});
  const [filter, setFilter] = useState('all'); // all | soon | later | dominant | blind
  const [override, setOverride] = useState(null); // 按自测反馈重生后的行动地图（手动"重做"）
  const [regen, setRegen] = useState(false);
  const [displayed, setDisplayed] = useState(null); // 当前展示：初版 / 后台升级版（无感替换）/ 手动版
  const [hasScrolled, setHasScrolled] = useState(false); // 用户是否正在读——决定能不能无感替换
  const [pendingSwap, setPendingSwap] = useState(false); // 用户正在读，不强制换，弹提示等他点
  const [showSignals, setShowSignals] = useState(false); // 默认折叠"两把尺子"，防页面过长
  const listRef = useRef(null);

  useEffect(() => { setDone(loadActions(data)); }, [data]);

  // 新一轮分析：回到初版
  useEffect(() => {
    setDisplayed(data?.actions || null);
    setOverride(null);
    setHasScrolled(false);
    setPendingSwap(false);
  }, [data]);

  // 决策A：后台升级版就绪时，按"用户是否正在读"决定无感替换 or 弹提示
  useEffect(() => {
    if (!prefetchedActions || override) { setPendingSwap(false); return; }
    if (hasScrolled) setPendingSwap(true); // 正在读初版，不强制换，等他点
    else { setDisplayed(prefetchedActions); setPendingSwap(false); } // 没在读，直接无感替换
  }, [prefetchedActions, override, hasScrolled]);

  const roleMap = useMemo(() => {
    const map = {};
    (data?.conflict?.roles || []).forEach((r) => { map[r.id] = r; });
    return map;
  }, [data]);

  // 与辨向自测的衔接：用当次自测的立场分布 / 盲区，给出优先做什么
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

  // 决策B「指出变化」：对比上一条带自测结果的历史存档，告诉用户"你判断变了没"
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

  function toggle(i) {
    const v = !done[i];
    setDone((d) => ({ ...d, [i]: v }));
    saveActions(data, i, v);
  }

  // 按自测反馈重生行动地图：把"最信哪一派 / 哪些盲区"发给后端，生成贴合辨向的验证路线
  async function regenerate() {
    if (!data.conflict?.roles?.length || !quizResult?.answeredCount) return;
    setRegen(true);
    try {
      const r = await api('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: data.topic || '',
          roles: data.conflict.roles,
          quizResult,
          persona: personaPayload ? personaPayload(persona || {}) : {},
        }),
      });
      if (r && r.actions && r.actions.length) {
        setOverride(r.actions); // 手动重做优先级最高
        setDisplayed(r.actions);
        setPendingSwap(false);
        setDone({});
        setFilter('all');
      }
    } catch (e) {
      // 失败则保留当前版本，不阻断
    } finally {
      setRegen(false);
    }
  }

  const actions = override || displayed; // 手动版 > 后台升级版 > 初版
  if (!actions || !actions.length) return null;
  const total = actions.length;
  const completed = Object.values(done).filter(Boolean).length;

  const indexedActions = useMemo(() => actions.map((a, i) => ({ ...a, originalIndex: i })), [actions]);

  const sortedActions = useMemo(() => {
    let arr = indexedActions;
    if (link && quizResult) {
      const dominantId = quizResult.dominant?.[0];
      const blindIds = quizResult.uncertainSides || [];
      const first = [];
      const second = [];
      const rest = [];
      arr.forEach((a) => {
        const roleName = roleMap[a.role]?.name || a.role;
        if (dominantId && a.role === dominantId) {
          first.push({ ...a, tag: `先验证你最信的「${esc(roleName)}」` });
        } else if (blindIds.length && blindIds.includes(a.role)) {
          second.push({ ...a, tag: `补你标了不确定的「${esc(roleName)}」视角` });
        } else {
          rest.push(a);
        }
      });
      arr = [...first, ...second, ...rest];
    }
    if (filter === 'soon') return arr.filter((a) => /接下来|今天|本周/.test(a.when || ''));
    if (filter === 'later') return arr.filter((a) => /本月|三个月/.test(a.when || ''));
    if (filter === 'dominant') {
      const id = quizResult?.dominant?.[0];
      return id ? arr.filter((a) => a.role === id) : arr;
    }
    if (filter === 'blind') {
      const ids = quizResult?.uncertainSides || [];
      return ids.length ? arr.filter((a) => ids.includes(a.role)) : arr;
    }
    return arr;
  }, [indexedActions, link, quizResult, roleMap, filter]);

  const usedHistory = data?.usedHistory || [];

  return (
    <section className="card actions">
      <h2>④ 决策验证路线（先验证判断，再下结论）</h2>
      <p className="muted">每条都在验证一个关键判断，并给了你「该坚持 / 该收手」两把尺子。勾掉已做的，剩下的再慢慢想。{completed > 0 && <span className="action-progress">已完成 {completed}/{total}</span>}</p>

      {usedHistory.length > 0 && (
        <div className="action-history">📚 本次参考了你 {usedHistory.length} 条历史炼金包（已自动避开无关话题，不会串味）</div>
      )}

      {changeInfo && (
        <div className="action-change">
          {changeInfo.date && <span className="ac-date">{changeInfo.date} 炼的「{esc(changeInfo.topic)}」</span>}
          {changeInfo.changed
            ? <>相比上次，你最信的立场从「<b>{esc(changeInfo.prevName)}</b>」变到了「<b>{esc(changeInfo.curName)}</b>」——这个变化值得想清楚为什么。</>
            : <>和上次一样，你最信的仍是「<b>{esc(changeInfo.curName)}</b>」，这次重点验证它是否真站得住。</>}
        </div>
      )}

      {link && (
        <div className="action-link">
          接上你刚才的辨向（{link.answered} 题）：
          {link.topName
            ? <>你更偏向 <b>{esc(link.topName)}</b>（{link.topN} 题）。排序已把验证这一派的任务提前，盲区视角的任务紧跟其后。</>
            : <>你还没给出明确的立场倾向（多数题选了「不确定」），排序已把补盲区的任务提前，先做这些拿一手事实。</>}
          {link.blinds.length > 0 && (
            <div className="action-link-blind">
              你在 <b>{esc(link.blinds.join('、'))}</b> 上标了「不确定」：这是你最该补的判断维度。
            </div>
          )}
        </div>
      )}

      {pendingSwap && (
        <div className="action-swap">
          ✨ 更贴合你自测结果的行动地图已生成
          <button type="button" className="link-btn" onClick={() => { setDisplayed(prefetchedActions); setPendingSwap(false); }}>点此查看 →</button>
        </div>
      )}
      {prefetching && !prefetchedActions && !override && (
        <div className="action-prefetching">正在结合你的自测结果优化行动地图…</div>
      )}

      <div className="action-filters">
        {[
          { k: 'all', label: '全部' },
          { k: 'soon', label: '近期先干' },
          { k: 'later', label: '长线准备' },
          { k: 'dominant', label: '最信视角' },
          { k: 'blind', label: '不确定视角' },
        ].map((c) => (
          <button
            key={c.k}
            type="button"
            className={filter === c.k ? 'active' : ''}
            onClick={() => setFilter(c.k)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="action-regen">
        <button type="button" className="chip primary" disabled={regen || !quizResult?.answeredCount} onClick={regenerate}>
          {regen ? '正在按你的辨向重生…' : '按我刚答的辨向，重做一份行动地图 →'}
        </button>
        {override && (
          <span className="action-regen-note">
            已按你的辨向重生：偏向 <b>{esc(link?.topName || '未明确')}</b>
            {link?.blinds?.length ? `，并补盲区 ${esc(link.blinds.join('、'))}` : ''}
          </span>
        )}
        <button type="button" className="link-btn" onClick={() => setShowSignals((s) => !s)}>
          {showSignals ? '收起' : '展开'}「该坚持 / 该收手」信号
        </button>
      </div>

      <ul className="action-list" ref={listRef} onScroll={() => setHasScrolled(true)}>
        {sortedActions.map((a) => (
          <li key={a.originalIndex} className={done[a.originalIndex] ? 'done' : ''} onClick={() => toggle(a.originalIndex)}>
            <input type="checkbox" readOnly checked={!!done[a.originalIndex]} />
            <div>
              {a.when && <span className="action-when">⏱ {esc(a.when)}</span>}
              {a.tag && <span className="action-tag">{esc(a.tag)}</span>}
              {a.hypothesis && <div className="action-hypo">🔍 要验证：{esc(a.hypothesis)}</div>}
              {a.where && <div className="action-where">📍 去哪儿：{esc(a.where)}</div>}
              {a.steps && <div className="action-steps">🎯 怎么做：{esc(a.steps)}</div>}
              {a.done && <div className="action-done">📦 做完算成：{esc(a.done)}</div>}
              {showSignals && a.goSignal && <div className="action-go">🟢 出现这些说明该坚持：{esc(a.goSignal)}</div>}
              {showSignals && a.stopSignal && <div className="action-stop">🛑 出现这些说明该收手 / 换路：{esc(a.stopSignal)}</div>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
