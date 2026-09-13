import React, { useMemo, useState } from 'react';
import {
  esc, loadRoad, loadRecords, saveRoad, summarizeActionFeedback,
  updateRecordActionFeedback, updateRecordCurrentTask, loadJournalState, saveJournalState,
} from '../lib.js';
import {
  JOURNAL_FILTERS, collectJournalArtifacts, collectJournalJudgments,
  judgmentStatusLabel,
} from '../journal.js';

const DECISIONS = [
  { id: 'keep', label: '保留原判断', desc: '现实结果没有动摇原来的看法。' },
  { id: 'revise', label: '修正条件', desc: '判断仍有价值，但需要补充成立条件。' },
  { id: 'defer', label: '暂不改变', desc: '现有样本还不够，继续等待证据。' },
  { id: 'release', label: '放下这条判断', desc: '暂时不再把它作为后续决策依据。' },
];

const CONDITION_DIMS = ['城市 / 地域', '学历 / 经历', '岗位类型', '时间压力', '薪酬与风险', '家庭容错'];

function fmtDate(ts) {
  if (!ts) return '日期未记录';
  const date = new Date(ts);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function verdictText(verdict) {
  return ({ up: '现实记录初步支持这条判断', down: '现实记录与原判断出现冲突', unclear: '现有样本还不足以下结论' })[verdict] || '已经带回一条现实记录';
}

function impactText(decision) {
  if (!decision) return '';
  if (decision.choice === 'keep') return '相似问题出现时，这条判断只会作为待确认的参考前提。';
  if (decision.choice === 'revise') return `相似问题出现时，会同时核对：${[...(decision.dimensions || []), decision.condition].filter(Boolean).join('、') || '你确认的成立条件'}。`;
  if (decision.choice === 'defer') return '这次结果不会被当成结论，判断会继续等待新的现实证据。';
  return '这条判断仍保留在时间线中，但不会再被主动带入新问题。';
}

function JudgmentCard({ item, onChanged, onOpenRecord }) {
  const [open, setOpen] = useState(item.status === 'waiting');
  const [choice, setChoice] = useState(item.state.memoryDecision?.choice || '');
  const [dimensions, setDimensions] = useState(item.state.memoryDecision?.dimensions || []);
  const [condition, setCondition] = useState(item.state.memoryDecision?.condition || '');
  const [error, setError] = useState('');
  const decision = item.state.memoryDecision;

  function toggleDimension(dim) {
    setDimensions((current) => current.includes(dim) ? current.filter((x) => x !== dim) : [...current, dim].slice(0, 3));
  }

  function confirmDecision() {
    if (!choice) return;
    if (choice === 'revise' && !dimensions.length && condition.trim().length < 4) {
      setError('至少选择一个条件维度，或写下一句具体的成立条件。');
      return;
    }
    const memoryDecision = { choice, dimensions, condition: condition.trim(), confirmedAt: Date.now() };
    saveRoad(item.record.data, item.roadKey, { memoryDecision, stage: choice === 'defer' ? 'doing' : 'confirmed' });
    const latestRoad = loadRoad(item.record.data);
    if (item.roadKey === '__current') {
      const current = latestRoad.__current;
      updateRecordCurrentTask(item.record.id, current);
    }
    updateRecordActionFeedback(item.record.id, summarizeActionFeedback(latestRoad));
    setError('');
    onChanged?.(loadRecords());
  }

  return (
    <article className={`journal-judgment status-${item.status}`}>
      <button type="button" className="journal-card-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="journal-status">{judgmentStatusLabel(item.status)}</span>
        <span className="journal-angle">{esc(item.angle)}</span>
        <strong>{esc(item.title)}</strong>
        <span className="journal-origin">来自「{esc(item.record.topic || '一条山径')}」 · {fmtDate(item.formedAt)}</span>
        <span className="journal-expand">{open ? '收起' : (item.status === 'waiting' ? '确认变化' : '查看时间线')}</span>
      </button>
      {open && (
        <div className="journal-card-body">
          <ol className="judgment-timeline">
            <li><time>{fmtDate(item.formedAt)}</time><div><b>形成判断</b><p>{esc(item.title)}</p></div></li>
            <li className={item.state.note ? '' : 'muted-event'}><time>{item.state.note ? fmtDate(item.updatedAt) : '等待中'}</time><div><b>{item.state.note ? '带回现实事实' : '等待现实事实'}</b><p>{esc(item.state.note || '回到行动路线完成验证，并写下真实看到的结果。')}</p>{item.state.evidenceUrl && <a href={item.state.evidenceUrl} target="_blank" rel="noreferrer">打开证据链接 ↗</a>}</div></li>
            {item.status === 'waiting' && item.state.verdict && <li><time>现在</time><div><b>系统提出变化</b><p>{verdictText(item.state.verdict)}。这只是候选解释，确认前不会影响下一次使用。</p></div></li>}
            {decision && <li className="confirmed-event"><time>{fmtDate(decision.confirmedAt)}</time><div><b>你确认的处理</b><p>{DECISIONS.find((x) => x.id === decision.choice)?.label}。{decision.condition || (decision.dimensions || []).join('、')}</p></div></li>}
          </ol>

          {item.status === 'waiting' && !decision && (
            <div className="journal-confirm">
              <h4>你想怎样保留这次变化？</h4>
              <div className="journal-decision-list">
                {DECISIONS.map((option) => (
                  <button key={option.id} type="button" className={choice === option.id ? 'active' : ''} onClick={() => setChoice(option.id)}>
                    <b>{option.label}</b><span>{option.desc}</span>
                  </button>
                ))}
              </div>
              {choice === 'revise' && (
                <div className="journal-revise">
                  <p><b>这条判断在什么条件下更可能成立？</b> 最多选 3 项，也可以补充一句。</p>
                  <div className="journal-dims">
                    {CONDITION_DIMS.map((dim) => <button key={dim} type="button" className={dimensions.includes(dim) ? 'active' : ''} onClick={() => toggleDimension(dim)}>{dim}</button>)}
                  </div>
                  <label><span>补充具体条件</span><input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="例如：已有相关实习，且岗位业务线仍在招聘时" /></label>
                  <small>系统只提供整理框架，这句话由你确认后才会成为长期记录。</small>
                </div>
              )}
              {choice && <div className="journal-impact-preview"><b>确认后：</b>{impactText({ choice, dimensions, condition })}</div>}
              {error && <div className="journal-error" role="alert">{error}</div>}
              <button type="button" className="primary journal-confirm-btn" disabled={!choice} onClick={confirmDecision}>确认这次处理</button>
            </div>
          )}

          {decision && <div className="journal-memory-impact"><b>下一次会怎样：</b>{impactText(decision)}</div>}
          <button type="button" className="link-btn journal-back-road" onClick={() => onOpenRecord?.(item.record)}>回到这条山径 →</button>
        </div>
      )}
    </article>
  );
}

function BagView({ artifacts, onOpenRecord, onChanged }) {
  const [journalState, setJournalState] = useState(loadJournalState());
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [expandedTypes, setExpandedTypes] = useState({});
  const [expandedMasters, setExpandedMasters] = useState({});
  const groups = journalState.artifactGroups || {};
  const groupedIds = new Set(Object.values(groups).flatMap((group) => group.items || []));
  const byType = artifacts.reduce((map, item) => {
    if (!map[item.type]) map[item.type] = [];
    map[item.type].push(item);
    return map;
  }, {});

  function mergeType(type, items) {
    const next = { ...journalState, artifactGroups: { ...groups, [type]: { name: type, items: items.map((item) => item.id), confirmedAt: Date.now() } } };
    saveJournalState(next); setJournalState(next); onChanged?.();
  }

  function unmerge(type) {
    const artifactGroups = { ...groups }; delete artifactGroups[type];
    const next = { ...journalState, artifactGroups };
    saveJournalState(next); setJournalState(next); onChanged?.();
  }

  function toggleExpanded(setter, type) {
    setter((current) => ({ ...current, [type]: !current[type] }));
  }

  function ArtifactRow({ item }) {
    return (
      <details className={`bag-artifact-row ${item.done ? 'done' : ''}`}>
        <summary>
          <span className="bag-artifact-dot" aria-hidden="true">{item.done ? '✓' : '·'}</span>
          <span className="bag-artifact-title"><b>{esc(item.name)}</b><small>来自「{esc(item.record.topic)}」</small></span>
          <span className="bag-artifact-state">{item.done ? '已形成' : '积累中'}</span>
        </summary>
        <div className="bag-artifact-detail">
          <p>{esc(item.text)}</p>
          {item.verify && <div className="bag-verify"><b>怎样验证</b><span>{esc(item.verify)}</span></div>}
          <div className="bag-source"><b>服务于这次判断</b><span>{esc(item.judgment)}</span></div>
          <button type="button" className="link-btn" onClick={() => onOpenRecord?.(item.record)}>回到来源山径 →</button>
        </div>
      </details>
    );
  }

  if (!artifacts.length) return <div className="journal-empty"><b>行囊还是空的</b><p>走完一条行动路线后，岗位地图、差距清单、作品和投递记录会留在这里。</p></div>;
  const suggestions = Object.entries(byType).filter(([type, items]) => items.length > 1 && !groups[type]);
  const looseGroups = Object.entries(byType).map(([type, items]) => [type, items.filter((item) => !groupedIds.has(item.id))]).filter(([, items]) => items.length);
  return (
    <div className="journal-bag">
      <div className="bag-intro"><b>成果不会散落在各条山径里</b><span>这里保存可继续使用的成果及其来源。相似成果只有在你确认后才会归入同一个母本。</span></div>
      {suggestions.length > 0 && (
        <section className="bag-merge-center">
          <button type="button" className="bag-merge-summary" aria-expanded={suggestionsOpen} onClick={() => setSuggestionsOpen((value) => !value)}>
            <span><b>{suggestions.length} 类成果可以整理成持续更新的母本</b><small>只是整理展示，不会覆盖任何原始记录</small></span>
            <span className="bag-merge-toggle">{suggestionsOpen ? '收起建议' : '查看建议'}</span>
          </button>
          {suggestionsOpen && <div className="bag-merge-options">
            {suggestions.map(([type, items]) => (
              <div className="bag-merge-option" key={type}>
                <div><b>{type}</b><span>{items.length} 份，来自 {new Set(items.map((item) => item.record.id || item.record.topic)).size} 条山径</span></div>
                <button type="button" className="chip" onClick={() => mergeType(type, items)}>建立母本</button>
              </div>
            ))}
          </div>}
        </section>
      )}
      {Object.entries(groups).map(([type, group]) => {
        const items = artifacts.filter((item) => group.items.includes(item.id));
        if (!items.length) return null;
        const showAll = expandedMasters[type];
        const visibleItems = showAll ? items : items.slice(0, 3);
        return <section className="bag-master" key={type}>
          <div className="bag-master-head"><div><span>持续更新的母本</span><h3>{esc(group.name)}</h3><p>{items.length} 次可追溯更新 · 最近 {fmtDate(Math.max(...items.map((x) => Number(x.updatedAt) || 0)))}</p></div><button className="link-btn" type="button" onClick={() => unmerge(type)}>拆回原记录</button></div>
          <div className="bag-updates">{visibleItems.map((item) => <button key={item.id} type="button" onClick={() => onOpenRecord?.(item.record)}><b>{fmtDate(item.updatedAt)}</b><span>{esc(item.record.topic)}</span><small>{item.done ? '已形成' : '积累中'}</small></button>)}</div>
          {items.length > 3 && <button type="button" className="bag-show-all" onClick={() => toggleExpanded(setExpandedMasters, type)}>{showAll ? '收起更新' : `查看全部 ${items.length} 次更新`}</button>}
        </section>;
      })}
      <div className="bag-type-list">
        {looseGroups.map(([type, items]) => {
          const showAll = expandedTypes[type];
          const visibleItems = showAll ? items : items.slice(0, 2);
          const completed = items.filter((item) => item.done).length;
          return <section className="bag-type-group" key={type}>
            <header><div><h3>{esc(type)}</h3><p>{items.length} 项积累 · {completed} 项已形成</p></div>{groups[type] ? <span>已归入母本</span> : items.length > 1 ? <span>待你决定是否合并</span> : null}</header>
            <div className="bag-type-items">{visibleItems.map((item) => <ArtifactRow key={item.id} item={item} />)}</div>
            {items.length > 2 && <button type="button" className="bag-show-all" onClick={() => toggleExpanded(setExpandedTypes, type)}>{showAll ? '收起' : `再看 ${items.length - 2} 项`}</button>}
          </section>;
        })}
      </div>
    </div>
  );
}

export default function ActionJournal({ records, onBack, onOpenRecord, onRecordsChange }) {
  const [view, setView] = useState('judgments');
  const [filter, setFilter] = useState('all');
  const judgments = useMemo(() => collectJournalJudgments(records), [records]);
  const artifacts = useMemo(() => collectJournalArtifacts(records), [records]);
  const visible = judgments.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'confirmed') return ['kept', 'revised', 'released'].includes(item.status);
    return item.status === filter;
  });
  const waiting = judgments.filter((item) => item.status === 'waiting').length;

  return (
    <section className="journal-page">
      <div className="journal-toolbar"><button className="chip ghost" type="button" onClick={onBack}>← 返回我的山径</button></div>
      <header className="journal-hero">
        <div><span className="journal-kicker">长期陪伴 · 由你确认的记忆</span><h1>行动簿</h1><p>这里记录的不是还有多少任务，而是你曾经怎样判断，现实后来告诉了你什么。</p></div>
        <aside><b>{waiting ? `${waiting} 条变化等你确认` : '目前没有变化需要确认'}</b><span>{waiting ? '确认前，它们不会影响下一次使用。' : '新的现实记录回来时，刘看山会提醒你。'}</span></aside>
      </header>
      <div className="journal-view-tabs" role="tablist" aria-label="行动簿视图">
        <button role="tab" aria-selected={view === 'judgments'} className={view === 'judgments' ? 'active' : ''} onClick={() => setView('judgments')}><b>判断</b><span>看自己的判断如何变化</span></button>
        <button role="tab" aria-selected={view === 'bag'} className={view === 'bag' ? 'active' : ''} onClick={() => setView('bag')}><b>行囊</b><span>查看积累的岗位、材料和作品</span></button>
      </div>
      {view === 'judgments' ? (
        <>
          <div className="journal-filters" aria-label="筛选判断">{JOURNAL_FILTERS.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label}{item.id === 'waiting' && waiting ? ` ${waiting}` : ''}</button>)}</div>
          <div className="journal-list">
            {visible.length ? visible.map((item) => <JudgmentCard key={item.id} item={item} onChanged={onRecordsChange} onOpenRecord={onOpenRecord} />) : <div className="journal-empty"><b>{filter === 'all' ? '还没有形成判断记录' : '这里暂时没有记录'}</b><p>从一条真实观点出发，完成现实验证后，它会成为你判断时间线上的第一步。</p></div>}
          </div>
        </>
      ) : <BagView artifacts={artifacts} onOpenRecord={onOpenRecord} onChanged={() => onRecordsChange?.(loadRecords())} />}
    </section>
  );
}
