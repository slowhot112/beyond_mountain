import React, { useRef, useState } from 'react';
import { esc, brief, normTitle, personaLabel, loadRoad, saveRoad, viewpointAngle, replaceInternalRoleIds, normalizeCurrentTask } from '../lib.js';

// 山头调色板：每个观点角色对应一条固定的山色，贯穿观点墙→自测→行动地图
const HILL = ['#2f6fa8', '#4c7a5a', '#8a6a3a', '#7c5cb0', '#0e7490'];
const VIEWPOINT_LABELS = ['一线从业者', '资深从业者', '行业观察者', '过来人'];
function displayRoleName(s, i) {
  const name = String(s?.name || '').trim();
  if (!name || /知乎答主|汤家凤|车辆工程考研|人生修炼手册|答主|来源/.test(name)) return VIEWPOINT_LABELS[i % VIEWPOINT_LABELS.length];
  return name;
}

// 后端偶尔会把 boundary 写成"代表个人观点"这类空话，前端兜底反向生成一条具体边界
function cleanBoundary(s) {
  const b = String(s.boundary || '').trim();
  if (!b || /代表.?个人观点|结合.?自己处境|仅供参考|请.?自行判断/.test(b)) {
    const core = (s.coreArg || s.stance || '').slice(0, 50);
    const fit = (s.bestFor || '').slice(0, 40);
    return `它认为"${core}…"这个结论成立的前提是：你的处境和"${fit || '该角色假设的背景'}"高度重合。`;
  }
  return b;
}

// 后端没给 rebuts 时，自动从 boundary+另一角色的 coreArg 生成一条交锋，避免"暂无交锋"空白
function makeFallbackRebut(s, roles) {
  if (Array.isArray(s.rebuts) && s.rebuts.length) return s.rebuts;
  const others = roles.filter((r) => r.id !== s.id);
  const target = others[0];
  if (!target) return [];
  const selfPre = cleanBoundary(s).replace(/^.*?: /, '').slice(0, 60);
  const targetArg = (target.coreArg || target.stance || target.name || '').slice(0, 60);
  return [{
    to: target.id,
    text: `如果"${selfPre}…"不成立，那 ${target.name || target.stance} 的质疑就成立：${targetArg}。`,
  }];
}

function cleanSourceTitle(t) {
  let s = String(t || '').trim();
  if (!s) return '相关讨论';
  s = s.replace(/\s*[-—–]\s*(知乎|知乎网|Zhihu|zhihu)\s*$/i, ''); // 去掉 " - 知乎" 尾巴
  s = s.replace(/[|｜]\s*《?[^》]*》?\s*$/, ''); // 去掉末尾 " | 《xxx》" 这类 SEO 尾巴
  if (s.length > 36) s = s.slice(0, 36) + '…';
  return s;
}

function sourceKind(item) {
  if (item?.demo || item?.source === 'demo') return 'demo';
  if (item?.source === 'web') return 'web';
  try {
    if (/(^|\.)zhihu\.com$/i.test(new URL(item?.url || '').hostname)) return 'zhihu';
  } catch {}
  return item?.url ? 'web' : 'unknown';
}

function roleSourceLabel(role, demo) {
  if (demo) return '演示素材';
  const sources = (role?.sourceItems || []).filter((item) => sourceKind(item) !== 'demo' && item?.url);
  if (!sources.length) return '暂无可核验原文';
  const zhihuCount = sources.filter((item) => sourceKind(item) === 'zhihu').length;
  const webCount = sources.filter((item) => sourceKind(item) === 'web').length;
  if (zhihuCount && webCount) return `知乎 ${zhihuCount} 条 · 全网 ${webCount} 条`;
  return zhihuCount ? `知乎原文 ${zhihuCount} 条` : `全网原文 ${webCount} 条`;
}

function SourceCard({ item, demo = false }) {
  const [open, setOpen] = useState(false);
  // 全网结果没有点赞数据（网页不点赞），它按权威等级参与排序；这里把来源与可信度标出来，让"信谁"有依据
  const kind = sourceKind(item);
  const isWeb = kind === 'web';
  const isDemo = demo || kind === 'demo';
  const parts = [];
  if (item.author) parts.push(item.author);
  if (!isDemo && item.voteUp) parts.push(`${item.voteUp} 赞`);
  const meta = parts.join(' · ');
  const title = cleanSourceTitle(item.title);
  return (
    <article className={`source-card${open ? ' expanded' : ''}${isWeb ? ' web' : ''}${isDemo ? ' demo' : ''}`}>
      <button
        type="button"
        className="source-card-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="source-card-main">
          <span className="source-title">{esc(title)}</span>
          <span className="source-badges">
            <span className={`src-badge ${isDemo ? 'demo' : (isWeb ? 'web' : 'zhihu')}`}>{isDemo ? '演示' : (isWeb ? '全网' : '知乎')}</span>
            {!isDemo && item.authority ? <span className="src-badge auth">参考级别 {esc(String(item.authority))}</span> : null}
          </span>
          <span className="source-meta">{esc(meta || (isDemo ? '示例内容' : '可打开核对原文'))}</span>
        </span>
        <span className="source-card-action">{open ? '收起摘要' : '查看摘要'} <span aria-hidden="true">{open ? '↑' : '↓'}</span></span>
      </button>
      {open && (
        <div className="source-details">
          <div className="source-brief">{esc(brief(item.summary))}</div>
          {isDemo || !item.url
            ? <span className="source-link source-link-disabled">演示素材，不对应外部文章</span>
            : <a href={item.url} target="_blank" rel="noreferrer" className="source-link">{isWeb ? '打开原文核对 ↗' : '打开知乎原文核对 ↗'}</a>}
        </div>
      )}
    </article>
  );
}

function RebutItem({ r, roles }) {
  // 兼容两种字段写法：新 {to, text} 与旧存档 {target, quote}
  const to = typeof r === 'string' ? '' : (r.to || r.target || '');
  const target = to ? roles.find((x) => x.id === to) : null;
  const text = typeof r === 'string' ? r : (r.text || r.quote || '');
  // 如果角色名带「·」，只显示派系前缀，避免 target 名长得像文章标题、和来源卡片视觉重复
  const targetFull = target?.name || target?.stance || to;
  const targetShort = target?.stance || target?.coreArg || '另一种观点';
  return (
    <div className="rebut-item">
      <span className="rebut-arrow">→</span>
      <span>{esc(replaceInternalRoleIds(text, roles))}{target && <span className="rebut-target" title={esc(targetFull)}>（针对“{esc(replaceInternalRoleIds(targetShort, roles))}”）</span>}</span>
    </div>
  );
}

// 长文默认只给前 max 字，避免整篇原文直接拍在用户脸上
function LongText({ text, max = 120 }) {
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
      >{open ? '收起' : '展开全文'}</button>
    </span>
  );
}

function PreviewLine({ s, i }) {
  const core = s.coreArg || s.stance || '';
  const short = core.length > 70 ? `${esc(core.slice(0, 70))}…` : esc(core);
  const items = s.sourceItems || [];
  const allDemo = items.length > 0 && items.every((it) => sourceKind(it) === 'demo');
  const zh = items.filter((it) => sourceKind(it) === 'zhihu').length;
  const web = items.filter((it) => sourceKind(it) === 'web').length;
  return (
    <div className="role-preview">
      <span className="role-preview-core">{short}</span>
      <span className="role-preview-meta">
        {items.length ? (allDemo ? `演示素材 ${items.length} 条 · ` : `来源 ${items.length} 条（知乎 ${zh} · 全网 ${web}） · `) : ''}适合 {esc((s.bestFor || '').slice(0, 24) || '…')}
      </span>
    </div>
  );
}

export default function ConflictWall({ conflict, persona, onNext, onTaskChange, demo = false, sourceStats, roadData = null }) {
  const savedTask = normalizeCurrentTask(roadData && loadRoad(roadData)?.__current);
  const [openIdx, setOpenIdx] = useState(() => conflict?.roles?.length ? 0 : null);
  const [taskStarted, setTaskStarted] = useState(() => Boolean(savedTask?.started));
  const [taskRoleId, setTaskRoleId] = useState(() => savedTask?.roleId || conflict?.roles?.[0]?.id || '');
  const [roleSignals, setRoleSignals] = useState(() => savedTask?.signals || {});
  const taskSectionRef = useRef(null);
  if (!conflict) return null;

  const firstRole = conflict.roles?.[0];
  const selectedRoleIndex = Math.max(0, (conflict.roles || []).findIndex((role) => role.id === taskRoleId));
  const selectedRole = conflict.roles?.[selectedRoleIndex] || firstRole;
  const selectedAngle = viewpointAngle(selectedRole, selectedRoleIndex);
  const fallbackTask = {
    verify: `先验证“${(firstRole?.stance || conflict.topic || '这条观点').slice(0, 54)}”是否真的适合你的处境。`,
    input: persona?.confusion ? '你的当前困惑，加上 1 个真实岗位或具体机会。' : '1 个真实岗位或具体机会，以及你现在的判断。',
    action: '找 1 个真实岗位，记录它的学历、技能和筛选要求；再对照今天看到的观点，写下“符合 / 不符合 / 还不确定”。',
    done: '你留下了一条真实记录，并能说清楚它支持了哪条观点，或让哪条观点需要修正。',
  };
  const task = conflict.currentTask || conflict.nextTask || fallbackTask;
  const sourceItems = (conflict.roles || []).flatMap((role) => role?.sourceItems || []);
  const hasZhihuSources = Number(sourceStats?.zhihuChosen || 0) > 0
    || sourceItems.some((item) => sourceKind(item) === 'zhihu');
  const hasWebSources = Number(sourceStats?.webChosen || 0) > 0
    || sourceItems.some((item) => sourceKind(item) === 'web');
  const hasVerifiableSources = hasZhihuSources || hasWebSources;
  const sourceIntro = demo
    ? `下面是根据你的处境生成的示例观点，共 ${conflict.roles.length} 个山头。`
    : !hasVerifiableSources
      ? '本次没有找到可核验原文，下面内容只能作为待验证假设。'
      : hasZhihuSources && hasWebSources
        ? `下面整理了知乎与全网来源中的 ${conflict.roles.length} 个山头。`
        : hasZhihuSources
          ? `下面整理了知乎原始来源中的 ${conflict.roles.length} 个山头。`
        : `本次未找到合适的知乎来源，下面整理了可打开核对的全网资料，共 ${conflict.roles.length} 个山头。`;
  const taskIsEvidenceOnly = !demo && !hasVerifiableSources;
  const generatedVerify = taskIsEvidenceOnly
    ? `当前没有可核验原文，先取到 1 条能打开的原始资料，再判断“${(task.verify || fallbackTask.verify).slice(0, 48)}”是否成立。`
    : (task.verify || task.goal || fallbackTask.verify);
  const useSavedQuestion = savedTask?.started && savedTask?.roleId === taskRoleId && savedTask?.verify;
  const taskVerify = useSavedQuestion ? savedTask.verify : (selectedRole
    ? `“${replaceInternalRoleIds(selectedRole.stance || selectedRole.coreArg || generatedVerify, conflict.roles)}”是否适合你的处境。`
    : generatedVerify);
  const taskRows = [
    { label: '取三个样本', text: '保存 3 个与你目标接近的真实岗位或机会，其中至少 1 个与这条判断相反。' },
    { label: '只记可核对事实', text: '记录招聘要求、实际工作、所在城市和薪酬福利，不把观点本身当成事实。' },
    { label: '回到行动路线', text: `带回链接和记录，再判断“${selectedAngle}”是较符合、不符合，还是仍不能确定。` },
  ];
  function persistCurrentTask(patch) {
    if (!roadData) return;
    const previous = normalizeCurrentTask(loadRoad(roadData)?.__current) || {};
    const next = { ...previous, flowVersion: 2, verify: taskVerify, roleId: taskRoleId, angle: selectedAngle, rows: taskRows, ...patch };
    saveRoad(roadData, '__current', next);
    onTaskChange?.(next);
  }
  function markRole(roleId, signal) {
    const nextSignals = { ...roleSignals, [roleId]: signal };
    setRoleSignals(nextSignals);
    const role = (conflict.roles || []).find((item) => item.id === roleId);
    if (!role) return;
    setTaskRoleId(roleId);
    const roleIndex = (conflict.roles || []).indexOf(role);
    const roleAngle = viewpointAngle(role, roleIndex);
    const roleVerify = `“${replaceInternalRoleIds(role.stance || role.coreArg || generatedVerify, conflict.roles)}”是否适合你的处境。`;
    persistCurrentTask({ roleId, angle: roleAngle, verify: roleVerify, signals: nextSignals, signalUpdatedAt: Date.now(), signalRole: roleId, signalAngle: roleAngle });
    window.requestAnimationFrame(() => taskSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  function selectTaskRole(roleId) {
    if (taskStarted) return;
    setTaskRoleId(roleId);
    window.requestAnimationFrame(() => taskSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  function toggle(i) {
    setOpenIdx((cur) => (cur === i ? null : i)); // 手风琴：展开一个，其他收起
  }

  return (
    <section className="card wall">
      <div className="wall-kicker">{demo ? '01 · 演示观点' : hasVerifiableSources ? '01 · 观点与原文' : '01 · 待验证假设'}</div>
      <h2>同一个问题，为什么会有不同答案？</h2>
      <p className="muted">{sourceIntro}先看每条观点的主张、适用处境和边界，再决定哪条值得你验证。</p>

      {persona && (() => {
        const pl = personaLabel(persona);
        if (!pl) return null;
        return <div className="wall-persona">你的处境：{esc(pl)}（下面每个观点都结合它来呈现，而非泛泛而谈）</div>;
      })()}

      <blockquote className="conflict-summary"><span className="summary-label">这次分歧</span>{esc(replaceInternalRoleIds(conflict.summary, conflict.roles))}</blockquote>

      <div className="roles">
        {conflict.roles.map((s, i) => (
          <article key={i} className={`role-card${openIdx === i ? ' active' : ''}`}>
            <button
              type="button"
              className="role-head"
              aria-expanded={openIdx === i}
              aria-controls={`role-body-${i}`}
              onClick={() => toggle(i)}
            >
              <div className="role-id">
                <span className="role-hill" style={{ background: HILL[i % HILL.length] }} />
                <span className={`role-mark role-mark-${(i % 5) + 1}`} aria-hidden="true">{i + 1}</span>
                <div>
                  <div className="role-name">{esc(displayRoleName(s, i))}</div>
                  <div className="role-form">{demo ? '观点身份 · 演示观点' : (s.sourceItems || []).some((item) => item?.url && sourceKind(item) !== 'demo') ? '观点身份 · 可核验来源' : '观点身份 · 待验证假设'}</div>
                </div>
              </div>
              <span className="role-toggle">{openIdx === i ? '收起' : '查看这条观点'}</span>
            </button>
            {openIdx !== i && <PreviewLine s={s} i={i} />}
            {openIdx === i && (
              <div className="role-body" id={`role-body-${i}`}>
                <div className="role-stance-box"><span>这条观点认为</span>{esc(s.stance)}</div>
                {s.persona && <p className="role-persona">{esc(s.persona)}</p>}
                <div className="role-context-grid">
                  <div><span>它依据什么</span><p><LongText text={s.coreArg} max={120} /></p></div>
                  <div><span>适合什么处境</span><p><LongText text={s.bestFor} max={80} /></p></div>
                  <div><span>成立的边界</span><p><LongText text={cleanBoundary(s)} max={80} /></p></div>
                  <div className="role-context-match"><span>与你的关系</span><p><LongText text={s.matchReason || '按你的路标写的'} max={140} /></p></div>
                </div>
                <div className="source-tags">
                  <span className="source-tag from"><span className="st-k">来源</span>{esc(roleSourceLabel(s, demo))}</span>
                  <span className="source-tag match"><span className="st-k">匹配</span>{esc(s.matchReason || '你的路标')}</span>
                </div>
                <div className="role-signal" aria-label="标记这条观点对你的关系">
                  <span>你怎么看这条：</span>
                  {[
                    ['like', '像我的处境'],
                    ['not-fit', '前提不适合我'],
                    ['unsure', '我还拿不准'],
                  ].map(([key, label]) => (
                    <button key={key} type="button" className={roleSignals[s.id] === key ? 'active' : ''} onClick={() => markRole(s.id, key)}>{label}</button>
                  ))}
                  <button type="button" className="role-signal-verify" onClick={() => { setTaskRoleId(s.id); markRole(s.id, 'verify'); }}>加入验证</button>
                  {roleSignals[s.id] && <small role="status">已记录：{roleSignals[s.id] === 'like' ? '下一步优先围绕这条自测' : roleSignals[s.id] === 'not-fit' ? '下一步会把它作为反例对照' : roleSignals[s.id] === 'unsure' ? '下一步会优先拆开它的前提' : '已加入当前验证问题'}</small>}
                </div>
                <div className="rebut">
                  <b>对其他山头的质疑：</b>
                  {makeFallbackRebut(s, conflict.roles).map((r, k) => <RebutItem key={k} r={r} roles={conflict.roles} />)}
                </div>
                {!taskStarted && (
                  <button type="button" className="role-verify-link" onClick={() => selectTaskRole(s.id)}>
                    想核对这条判断？把它带到下一步 <span aria-hidden="true">↓</span>
                  </button>
                )}
                <div className="sources">
                  <div className="role-source-heading"><span>{demo ? '示例脚印' : '原文脚印'}</span><small>{demo ? '当前为演示素材，不代表真实文章' : '点击来源卡片查看摘要，打开链接核对原文'}</small></div>
                  {(() => {
                    // 前端兜底去重：后端已经按归一化标题去重，这里再按渲染顺序去重一次
                    const seen = new Set();
                    const uniq = (s.sourceItems || []).filter((it) => {
                      const k = normTitle(it.title) || it.url;
                      if (!k) return true;
                      if (seen.has(k)) return false;
                      seen.add(k);
                      return true;
                    });
                    return uniq.length
                      ? uniq.map((it, j) => <SourceCard key={j} item={it} demo={demo} />)
                      : null;
                  })()}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
      <section ref={taskSectionRef} className={`current-task-card${taskStarted ? ' started' : ''}`} aria-labelledby="current-task-title">
        <div className="current-task-kicker">接着走 · 选一条值得核对的判断</div>
        <h3 id="current-task-title">别急着站队，先决定要验证什么</h3>
        <p className="current-task-intro">你现在只是在选问题，还没有开始做任务。自测会帮你判断它该排多靠前；到了行动路线，再记录样本和现实结果。</p>
        <div className="current-task-trail" aria-label="这项验证在产品中的流程">
          <span className="done">看过不同观点</span><i>→</i><strong>现在：选验证问题</strong><i>→</i><span>辨向排序</span><i>→</i><span>现实验证</span>
        </div>
        <div className="current-task-origin" aria-label="选择要验证的观点角度">
          {(conflict.roles || []).map((role, index) => (
            <button key={role.id || index} type="button" className={`current-task-angle${taskRoleId === role.id ? ' active' : ''}`} disabled={taskStarted} onClick={() => setTaskRoleId(role.id)}>
              <span>{index + 1}</span>{viewpointAngle(role, index)}
            </button>
          ))}
        </div>
        <div className="current-task-focus">
          <span>{taskIsEvidenceOnly ? '这次先取证' : `来自「${selectedAngle}」的判断`}</span>
          <p>{esc(replaceInternalRoleIds(taskVerify, conflict.roles))}</p>
        </div>
        <div className="current-task-method-label">进入行动路线后，会这样完成</div>
        <ol className="current-task-steps is-preview">
          {taskRows.map((row, index) => (
            <li key={row.label}>
              <div className="current-task-step-check" aria-label={`第 ${index + 1} 步：${row.label}`}>
                <span aria-hidden="true">{index + 1}</span>
                <div><b>{row.label}</b><p>{esc(row.text)}</p></div>
              </div>
            </li>
          ))}
        </ol>
        <div className="current-task-actions">
          <button type="button" className="primary" onClick={() => {
            if (!taskStarted) setTaskStarted(true);
            persistCurrentTask({ started: true, stage: 'selected', startedAt: savedTask?.startedAt || Date.now(), steps: {} });
            onNext?.();
          }}>
            {taskStarted ? '继续辨向 →' : '选定这个问题，进入辨向自测 →'}
          </button>
          {taskStarted && <span className="current-task-status" role="status" aria-live="polite">已选定，后续页面会继续显示这个问题</span>}
        </div>
        <p className="current-task-next-note">只有你在行动路线确认现实结果后，这条记录才会影响下一次判断。</p>
      </section>
      {onNext && !taskStarted && (
        <div className="wall-next">
          <button type="button" className="link-btn" onClick={onNext}>
            暂不加入任务，只做辨向自测 →
          </button>
        </div>
      )}
    </section>
  );
}
