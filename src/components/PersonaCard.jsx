import React, { useState } from 'react';
import { STAGES, GOALS, INDUSTRIES } from '../lib.js';

// 模块②：可编辑处境卡预览/确认（PRD 流程第3步）
export default function PersonaCard({ card, onConfirm, onEdit, onUploadResume, onPasteResume, resumeLoading, ocrProgress = 0, alchemyLoading, alchemyStep }) {
  const stage = STAGES.find((x) => x.id === card.stage) || STAGES[0];
  const goals = (card.goals || []).map((g) => (GOALS.find((x) => x.id === g) || {}).name).filter(Boolean);
  const ind = INDUSTRIES.find((x) => x.id === card.industry) || INDUSTRIES[0];
  const industryName = card.industryCustom?.trim() || ind.name;
  const subName = card.subCustom?.trim() || card.sub || ind.subs[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card);

  function save() { onEdit(draft); setEditing(false); }

  return (
    <section className="card personacard">
      <h2>② 处境卡（请确认系统将使用的匹配条件）</h2>
      <p className="muted">所有条件都可修改；确认后才进入知乎内容匹配。不上传简历也能继续。</p>

      {!editing ? (
        <div className="pc-view">
          <Row k="当前阶段" v={stage.name} />
          <Row k="当前目标" v={goals.join('、') || '（暂未明确）'} />
          <Row k="行业 / 细分" v={`${industryName} / ${subName}`} />
          <Row k="目标城市" v={card.city || '（未填）'} />
          <Row k="时间压力" v={card.timePressure || '（未填）'} />
          <Row k="当前困惑" v={card.confusion} />
          <Row k="背景摘要" v={card.education || '（未上传简历/未填）'} />
        </div>
      ) : (
        <div className="pc-edit">
          <label>背景摘要（可手动填写或上传简历后自动提取）
            <textarea rows={3} value={draft.education} onChange={(e) => setDraft({ ...draft, education: e.target.value })} placeholder="如：某211本科计算机，两段实习，无算法竞赛" />
          </label>
          <label>当前困惑
            <textarea rows={2} value={draft.confusion} onChange={(e) => setDraft({ ...draft, confusion: e.target.value })} />
          </label>
          <label>目标城市
            <input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder="如：上海" />
          </label>
        </div>
      )}

      <div className="pc-actions">
        {!editing ? (
          <>
            <button className="ghost" onClick={() => setEditing(true)}>编辑</button>
            <button className="ghost" onClick={onUploadResume} disabled={resumeLoading}>
              {resumeLoading
                ? (ocrProgress > 0 ? `图片识别中 ${ocrProgress}%…` : '解析中…')
                : '上传简历解析'}
            </button>
            <button className="ghost" onClick={() => {
              const text = window.prompt('请直接粘贴简历文字内容（支持从 PDF/Word/图片里复制出来的文字）：');
              if (text) onPasteResume(text);
            }} disabled={resumeLoading}>
              粘贴简历文字
            </button>
            <span className="muted" style={{ fontSize: 12 }}>支持 PDF/DOCX/TXT/图片(JPG·PNG)</span>
            <button className="primary" onClick={() => onConfirm(card)} disabled={alchemyLoading}>
              {alchemyLoading ? (alchemyStep || '炼制中…') : '确认，开始炼金'}
            </button>
          </>
        ) : (
          <>
            <button className="ghost" onClick={() => { setDraft(card); setEditing(false); }}>取消</button>
            <button className="primary" onClick={save}>保存修改</button>
          </>
        )}
      </div>
    </section>
  );
}

function Row({ k, v }) {
  return (
    <div className="pc-row">
      <span className="pc-k">{k}</span>
      <span className="pc-v">{v}</span>
    </div>
  );
}
