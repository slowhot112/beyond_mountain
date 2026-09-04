import React, { useState, useEffect, useRef } from 'react';
import Landing from './components/Landing.jsx';
import Onboarding from './components/Onboarding.jsx';
import PersonaCard from './components/PersonaCard.jsx';
import ConflictWall from './components/ConflictWall.jsx';
import Quiz from './components/Quiz.jsx';
import ActionMap from './components/ActionMap.jsx';
import ResultHub from './components/ResultHub.jsx';
import ResumeConfirm from './components/ResumeConfirm.jsx';

import ResultNav from './components/ResultNav.jsx';
import SpiritGuide from './components/SpiritGuide.jsx';
import {
  recordTopic, recordSide, dominantSide, loadHistory, exportMd, personaLabel, personaPayload, buildQueries, api,
  saveRecord, loadRecords, updateRecordQuiz,
} from './lib.js';
import { fileToText, loadSample, extractResume } from './resume.js';

const MODE = 'live';

export default function App() {
  const [step, setStep] = useState('landing'); // landing | onboarding | card | result1 | result2 | result3
  const [card, setCard] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(loadHistory());
  const [records, setRecords] = useState(loadRecords()); // 历史炼金包（完整存档，点开可回看）
  const [topic, setTopic] = useState('');
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeErr, setResumeErr] = useState(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [resumeConfirm, setResumeConfirm] = useState(null); // 解析结果确认弹窗数据
  const [alchemyLoading, setAlchemyLoading] = useState(false);
  const [alchemyStep, setAlchemyStep] = useState('');
  const [quizResult, setQuizResult] = useState(null); // 当次自测结果（立场分布 + 盲区），喂给行动地图
  const reqId = useRef(0);
  const currentRecordId = useRef(null); // 当前生成 / 正在回看的那条存档 id，答题结果写回它

  useEffect(() => { setHistory(loadHistory()); setRecords(loadRecords()); }, []);

  function buildCard(c) { setCard(c); setStep('card'); }

  async function runAlchery() {
    const myId = ++reqId.current;
    setError(null);
    setQuizResult(null);
    setAlchemyLoading(true);
    const steps = ['正在知乎山头拾脚印…', '正在全网找对照脚印…', '正在把不同脚印摆成对照…', '正在给你画脚下验证路线…'];
    let stepIdx = 0;
    setAlchemyStep(steps[0]);
    const stepTimer = setInterval(() => {
      stepIdx = (stepIdx + 1) % steps.length;
      setAlchemyStep(steps[stepIdx]);
    }, 2200);
    const persona = personaPayload(card);
    const topicStr = card.confusion.trim();
    setTopic(topicStr);
    try {
      const data = await api('/api/alchemy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: MODE, topic: topicStr, persona, queries: buildQueries(card) }),
      });
      if (myId !== reqId.current) return;
      if (!data || (!data.conflict && !data.topic)) throw new Error('返回数据为空或格式异常');
      setData(data);
      recordTopic(topicStr);
      setHistory(loadHistory());
      const rec = saveRecord({ card, data, quiz: null }); // 生成成功即自动存档，之后可完整回看
      if (rec) currentRecordId.current = rec.id;
      setRecords(loadRecords());
      setStep('result0'); // 先进总览，由用户选择进入 ②/③/④
    } catch (e) {
      if (myId !== reqId.current) return;
      setError(e.message || '网络错误');
    } finally {
      clearInterval(stepTimer);
      setAlchemyLoading(false);
      setAlchemyStep('');
    }
  }

  async function handleResume(file) {
    setResumeLoading(true); setResumeErr(null); setOcrProgress(0);
    try {
      console.log('[resume] start parse file:', file.name, file.type, file.size);
      const text = await fileToText(file, (p) => setOcrProgress(p));
      console.log('[resume] extracted text length:', text?.length);
      if (!text || !text.trim()) {
        setResumeErr('从文件中未识别到文字，可能是扫描版 PDF / 图片模糊 / 纯图片，请手动填写背景摘要。');
        return;
      }
      const r = await extractResume(text);
      console.log('[resume] server response:', r);
      if (r.ok && r.fields) {
        setResumeConfirm(r.fields); // 弹出确认/编辑框，用户确认后才写入
      } else if (r.reason === 'no-secret') {
        setResumeErr(r.message || '服务器未配置 OPENAI_API_KEY（知乎直答），已跳过自动解析，请手动填写背景摘要。');
      } else if (r.reason === 'empty') {
        setResumeErr('上传内容为空，请检查文件后重试或手动填写。');
      } else if (r.reason === 'llm-empty') {
        setResumeErr('大模型未返回结果（StepFun / 知乎直答），可重试或手动填写背景摘要。');
      } else {
        setResumeErr('解析未返回结构化结果，已保留文件文字，可手动填写背景摘要。');
      }
    } catch (e) {
      console.error('[resume] parse error:', e);
      const msg = e.message || '格式不支持';
      if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')) {
        setResumeErr('网络请求失败，请检查连接或手动填写背景摘要。');
      } else if (msg.includes('tesseract') || msg.includes('worker') || msg.includes('traineddata')) {
        setResumeErr('图片文字识别模型加载失败（网络或文件问题），请改用 PDF/文字版简历，或手动粘贴文字。');
      } else {
        setResumeErr('文件解析失败（' + msg + '），已切换手动填写。支持 PDF/DOCX/TXT/图片。');
      }
    } finally {
      setResumeLoading(false);
    }
  }

  // 兜底：直接粘贴简历文字
  async function handlePastedResume(text) {
    if (!text?.trim()) return;
    setResumeLoading(true); setResumeErr(null); setOcrProgress(0);
    try {
      const r = await extractResume(text);
      if (r.ok && r.fields) {
        setResumeConfirm(r.fields); // 弹出确认/编辑框
      } else if (r.reason === 'no-secret') {
        setResumeErr(r.message || '服务器未配置知乎 API Secret，请手动填写背景摘要。');
      } else {
        setResumeErr('解析未返回结构化结果，但已保留文字，可手动整理到背景摘要。');
      }
    } catch (e) {
      setResumeErr('粘贴内容解析失败：' + (e.message || '请手动填写背景摘要'));
    } finally {
      setResumeLoading(false);
    }
  }

  async function handleSample() {
    setResumeLoading(true); setResumeErr(null); setOcrProgress(0);
    try {
      const text = await loadSample();
      const r = await extractResume(text);
      if (r.ok && r.fields) {
        setResumeConfirm(r.fields); // 弹出确认/编辑框
      } else {
        // 样例即使 LLM 失败，也至少把原文背景填进去，保证演示不空
        setCard((c) => ({ ...c, education: '某211计算机本科，两段实习（推荐系统/AIGC），全栈项目，技能 Python/PyTorch/React', resumeExtracted: true }));
      }
    } catch (e) {
      setResumeErr('样例加载失败');
    } finally {
      setResumeLoading(false);
    }
  }

  function applyResumeFields(f) {
    const educationParts = [f.education, f.experience, f.projects && f.projects.length
      ? '项目：' + f.projects.map((p) => `${p.name}(${p.role})`).join('、')
      : '',
      f.certs?.length ? '证书：' + f.certs.join('、') : '',
      f.languages?.length ? '语言：' + f.languages.join('、') : '',
      f.salary ? '薪资：' + f.salary : '',
    ].filter(Boolean);
    const education = educationParts.join('；');
    setCard((c) => ({
      ...c,
      education: education || c.education,
      resumeExtracted: true,
      city: f.city || c.city,
      industry: f.industry ? mapIndustry(f.industry) : c.industry,
      customIndustry: f.industry && !mapIndustry(f.industry) ? f.industry : c.customIndustry,
      resumeFields: f, // 保留完整字段供后续展示
    }));
    setResumeConfirm(null);
  }

  function onQuizAnswer(_i, _v, side) {
    // Quiz 组件已把选项的 side（角色 id，如 r1/r2/r3）作为第三参传出，直接记录即可
    if (!side) return;
    recordSide(side);
  }

  // 答完自测后把结果写回「当前正在看的那条」存档（按 id 定位，不会串到别的存档）
  useEffect(() => {
    if (quizResult && quizResult.answeredCount > 0 && currentRecordId.current) {
      updateRecordQuiz(currentRecordId.current, quizResult);
    }
  }, [quizResult]);

  // 打开某条历史存档：把当时的处境卡与结果一起还原，像回到那天
  function openRecord(rec) {
    if (!rec || !rec.data) return;
    currentRecordId.current = rec.id;
    setCard(rec.card || null);
    setData(rec.data);
    setTopic(rec.topic || rec.data.topic || '');
    setQuizResult(rec.quiz || null);
    setStep('result0');
  }

  const dom = dominantSide();
  const domRole = dom && data ? (data.conflict?.roles || []).find((r) => r.id === dom.topId) : null;

  function ResultHead({ back }) {
    return (
      <div className="result-head">
        <h2>山径图：{esc0(topic)}</h2>
        <div className="result-actions">
          {back && <button className="chip" onClick={() => setStep('result0')}>← 返回总览</button>}
          <button className="chip" onClick={() => { setStep('onboarding'); setData(null); }}>← 重新建档</button>
          <button className="chip primary" onClick={() => exportMd(data)}>导出 Markdown</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {step !== 'landing' && (
        <header className="topbar">
          <div className="brand">山外山</div>
          <div className="brand-sub">不替你选路，只把众声摆成你能看清的山势</div>
        </header>
      )}

      <main className="container">
        {error && <div className="error">{error}</div>}

        {step === 'landing' && (
          <Landing
            onStart={() => setStep('onboarding')}
            records={records}
            onOpen={openRecord}
            />
        )}

        <SpiritGuide records={records} currentData={data} step={step} topic={topic} />

        {step === 'onboarding' && (
          <div className="back-row">
            <button className="chip ghost" onClick={() => setStep('landing')}>← 返回山脚</button>
          </div>
        )}

        {step === 'onboarding' && (
          <Onboarding initial={card} onBuildCard={buildCard} history={history} />
        )}

        {step === 'card' && card && (
          <PersonaCard
            card={card}
            onEdit={(c) => setCard(c)}
            onConfirm={runAlchery}
            onUploadResume={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.bmp';
              input.onchange = () => { if (input.files[0]) handleResume(input.files[0]); };
              input.click();
            }}
            onPasteResume={handlePastedResume}
            onLoadSample={handleSample}
            resumeLoading={resumeLoading}
            ocrProgress={ocrProgress}
            alchemyLoading={alchemyLoading}
            alchemyStep={alchemyStep}
          />
        )}

        {resumeErr && <div className="error">{resumeErr}</div>}

        {resumeConfirm && (
          <ResumeConfirm
            fields={resumeConfirm}
            onConfirm={applyResumeFields}
            onCancel={() => setResumeConfirm(null)}
          />
        )}

        {step.startsWith('result') && data && (
          <>
            <ResultNav
              current={step}
              onGoto={(s) => setStep(s)}
              onEditCard={() => setStep('card')}
              quizDone={!!dom}
            />
            {card && (
              <div className="persona-strip" aria-label="当前处境">
                <span className="ps-label">当前处境</span>
                <span className="ps-chip">{esc0(personaLabel(card))}</span>
                {card.confusion && <span className="ps-chip">最困惑：{esc0(card.confusion)}</span>}
                {card.timePressure && <span className="ps-chip">时间压力：{esc0(card.timePressure)}</span>}
              </div>
            )}
            {data.lowConfidence && (
              <div className="low-confidence-note">
                知乎上与你主题直接相关的高赞讨论不多，下面内容由相近主题的真实回答兜底。重点看哪些前提和你的处境接近，而不是照搬结论。
              </div>
            )}
            {step === 'result0' && (
              <ResultHub data={data} quizDone={!!dom} onGoto={(s) => setStep(s)} />
            )}
            {step === 'result1' && (
              <>
                <ResultHead back />
                <ConflictWall conflict={data.conflict} onNext={() => setStep('result2')} />
              </>
            )}
            {step === 'result2' && (
              <>
                <ResultHead back />
                {data.framework && (
                  <section className="card framework">
                    <h2>辨山尺（判断该信谁）</h2>
                    <p className="muted">带着这把尺子去下面的辨向自测：它会记下你每题偏向哪一派、哪里还“不确定”——正是你此刻最该看清的山势。</p>
                    <ul>{data.framework.dimensions.map((x, i) => <li key={i}><b>{x.dim}：</b>{x.guide}</li>)}</ul>
                  </section>
                )}
                <Quiz
                  quiz={data.quiz}
                  roles={data.conflict?.roles}
                  onAnswer={onQuizAnswer}
                  onProgress={setQuizResult}
                  onGotoActions={() => setStep('result3')}
                />
              </>
            )}
            {step === 'result3' && (
              <>
                <ResultHead back />
                {!dom && <div className="dep-note">请先完成【辨向自测】，才能生成专属你的脚下三步。</div>}
                {dom && <div className="dominant muted">你偏向：<b>{esc0(domRole?.name || dom.label)}</b>（基于 {dom.n}/{dom.total} 次自测）</div>}
                <ActionMap data={data} quizResult={quizResult} persona={card} />
              </>
            )}
          </>
        )}
      </main>


    </div>
  );
}

function esc0(s) { return s || ''; }
function mapIndustry(name) {
  const m = {
    ai: ['ai', '人工智能', 'aigc', '算法', '大模型', '机器学习', '深度学习', 'agent'],
    it: ['it', '开发', '前端', '后端', '软件', '测试', '运维', '产品'],
    finance: ['金融', '投行', '量化', '证券', '基金', '银行', '保险', '风控', '财富管理'],
    media: ['传媒', '内容', '编导', '新媒体', '广告', '公关', '品牌'],
    hr: ['hr', '人力', '招聘', '薪酬', 'hrbp'],
    live: ['直播', '主播', '短视频', 'mcn', '选品', '投流'],
    sport: ['运动', '体育', '健身', '教练'],
    logistics: ['物流', '供应链', '仓储', '采购'],
    edu: ['教育', '教师', '教研', '教培', '留学'],
    medical: ['医疗', '医药', '健康', '临床', '护理'],
    law: ['法律', '律师', '法务', '合规'],
    design: ['设计', '视觉', '交互', 'ui', 'ux', '工业设计'],
    manufacture: ['制造', '工业', '嵌入式', '自动化', '工艺'],
    consult: ['咨询', '研究', '分析'],
    civil: ['体制', '公务员', '事业单位', '央企', '国企'],
    consumer: ['消费', '零售', '电商', '门店'],
    realestate: ['房地产', '建筑', '地产', '工程', '造价'],
    energy: ['能源', '环保', '新能源', '电力', '化工'],
  };
  const lower = String(name).toLowerCase();
  for (const [k, keys] of Object.entries(m)) if (keys.some((x) => lower.includes(x))) return k;
  return 'ai';
}
