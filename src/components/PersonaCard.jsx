import React, { useState } from 'react';
import { STAGES, GOALS, INDUSTRIES } from '../lib.js';

// 模块②：可编辑处境卡预览/确认（PRD 流程第3步）
export default function PersonaCard({ card, onConfirm, onEdit, onUploadResume, onPasteResume, onLoadSample, resumeLoading, ocrProgress = 0, alchemyLoading, alchemyStep }) {
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
      <h2>② 确认路标</h2>
      <p className="muted">这些坐标会决定山外山去知乎的哪些山头拾脚印。所有条件都可修改，不上传简历也能继续。</p>

      {!editing ? (
        <div className="pc-view">
          <Row k="脚下路段" v={stage.name} />
          <Row k="想去的方向" v={goals.join('、') || '（暂未明确）'} />
          <Row k="所在山头" v={`${industryName} / ${subName}`} />
          <Row k="落脚城市" v={card.city || '（未填）'} />
          <Row k="决定窗口" v={card.timePressure || '（未填）'} />
          <Row k="站在哪个路口" v={card.confusion} />
          <Row k="行囊摘要" v={card.education || '（未上传简历/未填）'} />
        </div>
      ) : (
        <div className="pc-edit">
          <label>行囊摘要（可手动填写，或上传简历后自动整理）
            <textarea rows={3} value={draft.education} onChange={(e) => setDraft({ ...draft, education: e.target.value })} placeholder="如：某211本科计算机，两段实习，无算法竞赛" />
          </label>
          <label>站在哪个路口
            <textarea rows={2} value={draft.confusion} onChange={(e) => setDraft({ ...draft, confusion: e.target.value })} />
          </label>
          <label>落脚城市
            <input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder="如：上海" />
          </label>
        </div>
      )}

      <div className="pc-actions">
        {!editing ? (
          <>
            <button className="ghost" onClick={() => setEditing(true)}>调整路标</button>
            <button className="ghost" onClick={onUploadResume} disabled={resumeLoading}>
              {resumeLoading
                ? (ocrProgress > 0 ? `图片识别中 ${ocrProgress}%…` : '整理中…')
                : '上传简历，整理行囊'}
            </button>
            <button className="ghost" onClick={() => {
              const text = window.prompt('请直接粘贴简历或经历文字（支持从 PDF/Word/图片里复制出来的文字）：');
              if (text) onPasteResume(text);
            }} disabled={resumeLoading}>
              粘贴经历文字
            </button>
            <button className="primary" onClick={() => onConfirm(card)} disabled={alchemyLoading}>
              {alchemyLoading ? (alchemyStep || '进山寻路中…') : '进山，听不同的声音'}
            </button>
            <button className="ghost" onClick={onLoadSample} disabled={resumeLoading || alchemyLoading}>没头绪？先装个样例行囊</button>
            <span className="muted" style={{ fontSize: 12 }}>支持 PDF/DOCX/TXT/图片(JPG·PNG)</span>
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
