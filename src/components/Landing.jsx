import React from 'react';
import { esc, diffRouteChange, loadRoad, normalizeCurrentTask } from '../lib.js';
import { journalSummary } from '../journal.js';

// 「我的山径」：有历史时展示成长山径（时间线节点），无历史也露出「暂无记录」引导，
// 让"长期陪伴"的概念随时看得见。知识库对话已统一由右下角常驻的刘看山承担。
export default function Landing({ onStart, records = [], onOpen, onClear, onExport, onImport, onOpenJournal, auth = {}, authConfig = {}, onLogin, onSync }) {
  const list = Array.isArray(records) ? records : [];
  const has = list.length > 0;
  const journal = journalSummary(list);

  return (
    <section className="card landing">
      {has && <div className="far-hills far-hills-home" aria-hidden="true" />}
      {has ? (
        <h1 className="landing-title">我的山径</h1>
      ) : (
        <>
          <div className="landing-figure">
            <img className="landing-figure-img"
              src={`/liukanshan/${encodeURIComponent('待机_5秒_320x320_20fps_透明.gif')}`}
              width="168" height="168" decoding="async"
              alt="刘看山" />
          </div>
          <h1 className="landing-title">山外山</h1>
        </>
      )}

      <p className="landing-tagline">
        {has
          ? `你的山径上已有 ${list.length} 座山头${list.length >= 30 ? '（山径最多记 30 座山头，更早的会被新的替下）' : ''}。每次炼金都是插下的一面小旗——点开任意一座，都能回到那天你看到的山势。`
          : '山外有山，路在脚下。每一次炼金，都是你在山径上插的一面小旗。'}
      </p>

      {has && (
        <button type="button" className="landing-journal-entry" onClick={onOpenJournal}>
          <span className="lje-mark" aria-hidden="true">↗</span>
          <span><b>行动簿</b><small>看判断如何被现实改写</small></span>
          <span className={journal.waiting ? 'lje-status attention' : 'lje-status'}>{journal.waiting ? `${journal.waiting} 条变化等你确认` : `${journal.verifying} 条正在验证`}</span>
        </button>
      )}

      {!has && (
        <p className="landing-desc">
          知乎上的每一条过来人经验，都是一座有人翻过的山。山外山不替你决定翻哪座山——它接入知乎搜索、全网搜索与知乎直答，从真实高赞讨论里拾起与你处境相近的脚印，摆成几种声音。
        </p>
      )}

      <div className="landing-actions">
        <button className="primary landing-start" onClick={onStart}>
          {has ? '再插一面旗 →' : '标记我的位置 →'}
        </button>
        {has && (
          <button className="link-btn landing-clear" onClick={() => {
            if (window.confirm('确定清空这台设备上的山径、答题偏好和行动进度吗？此操作无法撤销。')) onClear?.();
          }}>
            清空本地记录
          </button>
        )}
        <div className="landing-archive-actions">
          <button type="button" className="link-btn" onClick={onExport}>导出山径档案</button>
          <label className="link-btn landing-import">导入档案
            <input type="file" accept="application/json,.json" onChange={(e) => { onImport?.(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <small className="landing-storage-note">{auth?.authenticated ? '已登录：行动簿可同步到知乎账号；每次合并前都会先让你确认。' : '记录保存在当前设备；换设备时导出后再导入，不会自动同步到云端。'}</small>
        <div className="landing-account" aria-live="polite">
          {auth?.authenticated ? (
            <><span className="landing-account-state">已连接知乎账号：{auth.user?.name || '知乎用户'}</span><button type="button" className="link-btn" onClick={onSync}>同步行动簿</button></>
          ) : authConfig?.enabled ? (
            <><span className="landing-account-copy">想在其他设备继续？</span><button type="button" className="oauth-btn" onClick={onLogin}>使用知乎登录</button></>
          ) : <span className="landing-account-copy">知乎登录同步尚未配置，当前可用游客模式和档案迁移。</span>}
        </div>
        {!has && <span className="landing-hint muted">先说说你站在哪个路口，约两分钟给你画出路标</span>}
      </div>

      <div className="growth-map">
        {has ? (
          list.map((r, idx) => {
            // 与更早那次相比：判断/路线变没变（历史页要能一眼看出"这次和上次差在哪"）
            const older = list[idx + 1] || null;
            const ch = diffRouteChange(older, r.quiz, (r.data && r.data.conflict && r.data.conflict.roles) || []);
            const fb = r.actionFeedback || null;
            const hasFb = fb && (fb.done || (fb.up && fb.up.length) || (fb.down && fb.down.length) || (fb.unclear && fb.unclear.length) || (fb.notes && fb.notes.length));
            const currentTask = normalizeCurrentTask(r.currentTask || (r.data ? loadRoad(r.data)?.__current : null));
            const preparationTotal = Math.max(1, ((currentTask?.rows || []).length || 3) - 1);
            const taskStepCount = Object.entries(currentTask?.steps || {}).filter(([index, done]) => done && Number(index) < preparationTotal).length;
            return (
              <button key={r.id} className={`map-node ${hasFb ? 'has-fb' : 'pending'}`} onClick={() => onOpen && onOpen(r)}>
                <span className="map-dot" aria-hidden="true" />
                <div className="map-card">
                  <div className="map-topic">{r.topic || '未命名'}</div>
                  <div className="map-meta">
                    {new Date(r.ts).toLocaleDateString()}
                    {r.fallback && <em className="record-flag" title="这次知乎直答没连上，展示的是原样摆着的真实脚印，没经过二次整理"> · 原始山径</em>}
                    {!r.fallback && r.lowConfidence && <em className="record-flag" title="知乎上直接聊这个的不多，内容由相近主题的真实讨论垫上"> · 素材偏少</em>}
                  </div>
                  {currentTask?.started && !currentTask?.verdict && (
                    <div className="map-current-task">待验证 · 准备 {taskStepCount}/{preparationTotal}</div>
                  )}
                  {/* 上一次做了什么、结果如何（行动结果反哺后才有） */}
                  {hasFb && (
                    <div className="map-feedback">
                      上次走了 <b>{fb.done || 0}</b> 段 · 走通 <b>{(fb.up || []).length}</b> · 塌方 <b>{(fb.down || []).length}</b> · 还在雾里 <b>{(fb.unclear || []).length}</b>
                      {(fb.notes && fb.notes.length) ? (
                        <div className="map-note">你上次记下的：{esc(fb.notes[fb.notes.length - 1].note)}</div>
                      ) : null}
                    </div>
                  )}
                  {/* 只描述有限样本下的答题倾向，不推断用户信任某位答主 */}
                  {ch && (ch.changed || (ch.prevName && ch.curName)) && (
                    <div className="map-change">
                      {ch.changed
                        ? <>两轮答题出现了不同倾向：{ch.date || '上一轮'}更接近「{esc(ch.prevName)}」，本轮更接近「{esc(ch.curName)}」。问题和处境可能不同，这条变化只作为后续验证线索。</>
                        : <>本轮较多选择仍接近「{esc(ch.curName || ch.prevName)}」。这只反映当时题目下的倾向，不代表你认同某位答主。</>}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        ) : (
          <div className="growth-map-empty">
            你的成长山径 · <b>还空着</b><br />
            炼出第一个炼金包后，这里会亮起一座座山头，串成你的路。
          </div>
        )}
      </div>
    </section>
  );
}
