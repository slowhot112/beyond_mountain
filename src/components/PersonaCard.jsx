import React, { useEffect, useState } from 'react';
import { STAGES, GOALS, INDUSTRIES } from '../lib.js';

const liukanshanGif = (name) => '/liukanshan/' + encodeURIComponent(name);
const LOADING_GIF = liukanshanGif('电脑_6秒_320x320_20fps_透明.gif');
const ALCHEMY_STEPS = ['寻找知乎真实讨论', '补充全网对照资料', '比对观点成立的前提', '整理成可阅读的结果'];

// 模块②：可编辑处境卡预览/确认（PRD 流程第3步）
export default function PersonaCard({ card, onConfirm, onEdit, onUploadResume, onPasteResume, onLoadSample, resumeLoading, ocrProgress = 0, alchemyLoading, alchemyStep }) {
  const stage = STAGES.find((x) => x.id === card.stage) || STAGES[0];
  const goals = (card.goals || []).map((g) => (GOALS.find((x) => x.id === g) || {}).name).filter(Boolean);
  const ind = INDUSTRIES.find((x) => x.id === card.industry) || INDUSTRIES[0];
  const industryName = card.customIndustry?.trim() || card.industryCustom?.trim() || ind.name;
  const subName = card.subCustom?.trim() || card.sub || ind.subs[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const loadingIndex = Math.max(0, ALCHEMY_STEPS.indexOf(alchemyStep));
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!alchemyLoading) { setElapsed(0); return undefined; }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [alchemyLoading]);

  function save() { onEdit(draft); setEditing(false); }

  return (
    <section className="card personacard">
      <h2>② 确认路标</h2>
      <p className="muted">这些坐标会决定山外山去知乎的哪些山头拾脚印。所有条件都可修改，不上传简历也能继续。</p>

      {alchemyLoading && (
        <div className="pc-loading" role="status" aria-live="polite" aria-label="正在检索并整理真实资料">
          <div className="pc-loading-card">
            <img src={LOADING_GIF} alt="刘看山正在翻资料" width="128" height="128" decoding="async" className="pc-loading-gif" />
            <div className="pc-loading-copy">
              <div className="pc-loading-eyebrow">刘看山正在查资料</div>
              <h3>{alchemyStep || ALCHEMY_STEPS[0]}</h3>
              <div className="pc-loading-time">已用时 {elapsed} 秒 · 正在进行第 {loadingIndex + 1}/4 步</div>
              <div className="pc-loading-steps" aria-hidden="true">
                {ALCHEMY_STEPS.map((item, index) => (
                  <div key={item} className={`pc-loading-step${index < loadingIndex ? ' done' : ''}${index === loadingIndex ? ' active' : ''}`}>
                    <span>{index < loadingIndex ? '✓' : index + 1}</span>{item}
                  </div>
                ))}
              </div>
              <div className="pc-loading-note">需要同时打开并核对真实来源，通常需要 30–90 秒。完成后会自动进入观山台，请勿重复点击。</div>
            </div>
          </div>
        </div>
      )}

      {!editing ? (
        <div className="pc-view">
          <div className="pc-focus-question"><span>本次要判断</span><strong>{card.confusion}</strong></div>
          <div className="pc-coordinates" aria-label="本次检索条件">
            <Row k="当前阶段" v={stage.name} />
            <Row k="目标方向" v={goals.join('、') || '暂未明确'} />
            <Row k="关注领域" v={`${industryName} / ${subName}`} />
            <Row k="目标城市" v={card.city || '未补充'} optional={!card.city} />
            <Row k="决定时间" v={card.timePressure || '未补充'} optional={!card.timePressure} />
            <Row k="经历摘要" v={card.education || '未补充'} optional={!card.education} />
          </div>
          <p className="pc-impact-note">检索会优先匹配与你阶段、方向和领域相近的真实经历；未补充项不会阻止你继续。</p>
        </div>
      ) : (
        <div className="pc-edit">
          <label>行囊摘要（可手动填写，或上传简历后自动整理）
            <textarea aria-label="行囊摘要" rows={3} value={draft.education} onChange={(e) => setDraft({ ...draft, education: e.target.value })} placeholder="如：某211本科计算机，两段实习，无算法竞赛" />
          </label>
          <label>站在哪个路口
            <textarea aria-label="站在哪个路口" rows={2} value={draft.confusion} onChange={(e) => setDraft({ ...draft, confusion: e.target.value })} />
          </label>
          <label>落脚城市
            <input aria-label="落脚城市" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder="如：上海" />
          </label>
        </div>
      )}

      <div className="pc-actions">
        {!editing ? (
          <>
            <button className="primary" onClick={() => onConfirm(card)} disabled={alchemyLoading}>
              {alchemyLoading ? (alchemyStep || '进山寻路中…') : '进山，听不同的声音'}
            </button>
            <button className="ghost" onClick={() => setEditing(true)}>调整路标</button>
            <details className="resume-tools">
              <summary>用简历补充背景（可选）</summary>
              <p className="muted">不上传也能完整使用。支持 PDF、DOCX、TXT 和图片。</p>
              <label className={`resume-privacy${privacyAccepted ? '' : ' needs-confirmation'}`}>
                <input type="checkbox" checked={privacyAccepted} onChange={(e) => setPrivacyAccepted(e.target.checked)} />
                <span className="resume-privacy-copy">
                  <b>我知道</b>：原文件只在浏览器读取，不会上传；提取出的文字会发到后端并交给模型整理。姓名、电话、邮箱不会保存到处境卡或本地历史。
                  {!privacyAccepted && <em>先勾选，才能使用简历</em>}
                </span>
              </label>
              {!privacyAccepted && (
                <div id="resume-privacy-hint" className="resume-action-hint" role="status" aria-live="polite">
                  <span className="resume-hint-icon" aria-hidden="true">↓</span>
                  文件选择和粘贴经历需要先勾选上面的隐私确认；使用示例背景无需勾选，可直接体验。
                </div>
              )}
              <div className="resume-tool-actions">
                <button className="ghost" onClick={onUploadResume} aria-describedby={!privacyAccepted ? 'resume-privacy-hint' : undefined} disabled={resumeLoading || !privacyAccepted} title={!privacyAccepted ? '请先勾选隐私确认' : undefined}>
                  {resumeLoading
                    ? (ocrProgress > 0 ? `图片识别中 ${ocrProgress}%…` : '整理中…')
                    : '选择简历文件'}
                </button>
                <button className="ghost" aria-describedby={!privacyAccepted ? 'resume-privacy-hint' : undefined} onClick={() => {
                  const text = window.prompt('请直接粘贴简历或经历文字（支持从 PDF/Word/图片里复制出来的文字）：');
                  if (text) onPasteResume(text);
                }} disabled={resumeLoading || !privacyAccepted} title={!privacyAccepted ? '请先勾选隐私确认' : undefined}>
                  粘贴经历文字
                </button>
                <button className="link-btn" onClick={onLoadSample} disabled={resumeLoading || alchemyLoading}>使用示例背景</button>
              </div>
            </details>
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

function Row({ k, v, optional = false }) {
  return (
    <div className={`pc-row${optional ? ' optional' : ''}`}>
      <span className="pc-k">{k}</span>
      <span className="pc-v">{v}</span>
    </div>
  );
}
