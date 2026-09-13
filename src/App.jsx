import React, { useState, useEffect, useRef, useMemo } from 'react';
import Landing from './components/Landing.jsx';
import Onboarding from './components/Onboarding.jsx';
import PersonaCard from './components/PersonaCard.jsx';
import ConflictWall from './components/ConflictWall.jsx';
import Quiz from './components/Quiz.jsx';
import ActionMap from './components/ActionMap.jsx';
import ActionJournal from './components/ActionJournal.jsx';
import MemoryCarryover from './components/MemoryCarryover.jsx';
import ResultHub from './components/ResultHub.jsx';
import ResumeConfirm from './components/ResumeConfirm.jsx';

import ResultNav from './components/ResultNav.jsx';
import SpiritGuide from './components/SpiritGuide.jsx';
import {
  recordTopic, recordSide, loadHistory, exportMd, personaLabel, personaPayload, buildQueries, api,
  saveRecord, loadRecords, loadRoad, saveRoad, updateRecordQuiz, updateRecordRoadmap, updateRecordCurrentTask, flattenRoadmap,
  buildAlchemyPayload, collectActionFeedback, updateRecordActionFeedback,
  routeConfidence, routeMissingCount, canGenerateFullRoute, clearLocalData,
  exportLocalArchive, importLocalArchive, inspectLocalArchive, viewpointAngle, normalizeCurrentTask,
} from './lib.js';
import { fileToText, loadSample, extractResume } from './resume.js';
import './mountain.css';
import { findCarryoverCandidates } from './journal.js';

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
  const [prefetchedActions, setPrefetchedActions] = useState(null); // 决策A：进入第④步时生成的"带终点完整路线"（含 roadmap）
  const [visitedResults, setVisitedResults] = useState([]);
  const reqId = useRef(0);
  const currentRecordId = useRef(null); // 当前生成 / 正在回看的那条存档 id，答题结果写回它
  const [metaOpen, setMetaOpen] = useState(false); // 结果页顶部来源提示：默认收起
  const [guidePrompt, setGuidePrompt] = useState(null);
  const [auth, setAuth] = useState({ loading: true, authenticated: false, user: null });
  const [authConfig, setAuthConfig] = useState({ enabled: false });
  const [carryoverChoice, setCarryoverChoice] = useState(null);
  const carryoverCandidates = useMemo(() => findCarryoverCandidates(records, card || {}), [records, card]);

  useEffect(() => {
    setHistory(loadHistory()); setRecords(loadRecords());
    Promise.all([api('/api/auth/config'), api('/api/auth/me')]).then(([config, me]) => {
      setAuthConfig(config || { enabled: false }); setAuth(me || { authenticated: false });
    }).catch(() => setAuth({ loading: false, authenticated: false }));
  }, []);

  async function startZhihuLogin() {
    try {
      const result = await api('/api/auth/login');
      if (result?.data?.authorizeUrl) window.location.assign(result.data.authorizeUrl);
      else setError(result?.message || '当前无法发起知乎登录，仍可继续游客模式。');
    } catch { setError('知乎登录暂时不可用，仍可继续游客模式。'); }
  }

  async function syncArchive() {
    if (!auth.authenticated) return startZhihuLogin();
    try {
      const remote = await api('/api/sync/archive');
      if (remote?.archive) {
        const overwriteLocal = window.confirm('云端已有行动簿档案。点击“确定”将云端记录带回本机，并覆盖同主题记录；点击“取消”保留本机同主题记录。\n\n两种选择都会合并不冲突的记录，不会静默删除另一端内容。');
        importLocalArchive(remote.archive, { overwriteConflicts: overwriteLocal });
      }
      await api('/api/sync/archive', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archive: exportLocalArchive() }) });
      setRecords(loadRecords()); setError('行动簿已完成一次同步。');
    } catch { setError('同步没有完成，本地行动簿不受影响。'); }
  }

  function go(stepName) {
    setError(null);
    setStep(stepName);
    if (stepName.startsWith('result')) {
      setVisitedResults((prev) => prev.includes(stepName) ? prev : [...prev, stepName]);
    }
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  function buildCard(c) { setCard(c); setCarryoverChoice(null); go('card'); }

  function handleExportArchive() {
    try {
      const blob = new Blob([JSON.stringify(exportLocalArchive(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `山外山-山径-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { setError('山径档案导出失败，请稍后再试。'); }
  }

  async function handleImportArchive(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const inspection = inspectLocalArchive(payload);
      if (inspection.conflicts.length) {
        const keepLocal = window.confirm(`发现 ${inspection.conflicts.length} 条与本机相同主题的记录。\n\n确定覆盖本机记录吗？选择“取消”将保留本机记录，只导入不冲突的内容。\n\n本操作不会删除导入档案文件。`);
        const merged = importLocalArchive(payload, { overwriteConflicts: keepLocal });
        setRecords(merged);
        setHistory(loadHistory());
        setError(keepLocal ? `已导入并更新 ${inspection.conflicts.length} 条冲突记录。` : `已保留本机记录，并导入 ${inspection.added} 条不冲突记录。`);
        return;
      }
      const merged = importLocalArchive(payload);
      setRecords(merged);
      setHistory(loadHistory());
      setError(null);
    } catch (e) {
      setError(e.message || '山径档案导入失败，请选择正确的 JSON 档案。');
    }
  }

  async function runAlchery() {
    if (carryoverCandidates.length && carryoverChoice === null) {
      setError('行动簿里有与你当前处境相近的旧判断。请先确认是否带入，再生成本次结果。');
      requestAnimationFrame(() => document.querySelector('.memory-carryover')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    const myId = ++reqId.current;
    setError(null);
    setQuizResult(null);
    setPrefetchedActions(null); // 新一轮分析，清空旧的预生成结果
    setVisitedResults([]);
    setAlchemyLoading(true);
    const steps = ['寻找知乎真实讨论', '补充全网对照资料', '比对观点成立的前提', '整理成可阅读的结果'];
    let stepIdx = 0;
    setAlchemyStep(steps[0]);
    const stepTimer = setInterval(() => {
      if (stepIdx >= steps.length - 1) {
        clearInterval(stepTimer);
        return;
      }
      stepIdx += 1;
      setAlchemyStep(steps[stepIdx]);
    }, 7000);
    const persona = personaPayload(card);
    const topicStr = card.confusion.trim();
    setTopic(topicStr);
    try {
      // 联动：把历史存档（含上一轮的行动结果 feedback）一起交给后端，
      // 下次炼金才知道「哪些判断已经验证过、哪条路线被现实打脸」，避免重复验证、该换路的换路。
      const data = await api('/api/alchemy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAlchemyPayload({
          mode: MODE,
          topic: topicStr,
          persona,
          queries: buildQueries(card),
          records: carryoverChoice?.length
            ? records.filter((record) => carryoverCandidates.some((item) => carryoverChoice.includes(item.id) && item.record.id === record.id))
            : [],
        })),
      });
      if (myId !== reqId.current) return;
      if (!data || (!data.conflict && !data.topic)) throw new Error('返回数据为空或格式异常');
      setData(data);
      recordTopic(topicStr);
      setHistory(loadHistory());
      const rec = saveRecord({ card, data, quiz: null }); // 生成成功即自动存档，之后可完整回看
      if (rec) currentRecordId.current = rec.id;
      setRecords(loadRecords());
      go('result0'); // 先进总览，由用户选择进入 ②/③/④
    } catch (e) {
      if (myId !== reqId.current) return;
      if (e.name === 'AbortError') setError('这次寻找超过两分钟了。你的路标还在，可以直接重试；我们不会重复保存失败结果。');
      else if (e.code === 'RATE_LIMITED') setError('操作有点快，请稍等一分钟再试。你的路标和已填内容都还在。');
      else if (e.code === 'DAILY_LIMIT_REACHED') setError('今天的生成额度已用完。你可以保留路标，稍后再来；已有山径仍可正常回看。');
      else setError(e.message || '没连上服务。你的路标还在，可以直接重试。');
    } finally {
      clearInterval(stepTimer);
      setAlchemyLoading(false);
      setAlchemyStep('');
    }
  }

  async function handleResume(file) {
    setResumeLoading(true); setResumeErr(null); setOcrProgress(0);
    try {
      const text = await fileToText(file, (p) => setOcrProgress(p));
      if (!text || !text.trim()) {
        setResumeErr('这份文件里没读出字（可能是扫描件、图太糊，或整页就是张图），你手动填背景就行。');
        return;
      }
      const r = await extractResume(text);
      if (r.ok && r.fields) {
        setResumeConfirm(r.fields); // 弹出确认/编辑框，用户确认后才写入
      } else if (r.reason === 'no-secret') {
        setResumeErr(r.message || '还没接上知乎直答，这份简历我读不了，你手动填背景就能继续。');
      } else if (r.reason === 'empty') {
        setResumeErr('上传内容为空，请检查文件后重试或手动填写。');
      } else if (r.reason === 'llm-empty') {
        setResumeErr('这会儿没读出来，你可以再试一次，或手动填背景。');
      } else {
        setResumeErr('这份我读不出个眉目，文字我留着了，你手动整理一下就行。');
      }
    } catch (e) {
      const msg = e.message || '格式不支持';
      if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')) {
        setResumeErr('网没连上，你手动填背景也能继续。');
      } else if (msg.includes('tesseract') || msg.includes('worker') || msg.includes('traineddata')) {
        setResumeErr('图片里的字这会儿认不出来，换文字版简历，或直接把文字粘过来。');
      } else {
        setResumeErr('这份文件我读不了，已换成手动填写。支持 PDF / Word / TXT / 图片。');
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
        setResumeErr('这份我读不出个眉目，文字我留着了，你手动整理一下就行。');
      }
    } catch (e) {
      setResumeErr('这段字我没读明白：' + (e.message || '请手动填写背景摘要'));
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

  // 生成"带终点完整路线"的动作集中在行动地图组件内触发（进入第④步自动拉取，或用户手动点"重做"）。
  // 路线就绪后这里把 roadmap 写回存档，保证回看历史时不重复消耗直答。
  function handleRouteReady(roadmap) {
    if (!roadmap) return;
    setPrefetchedActions((prev) => (prev ? { ...prev, roadmap } : { roadmap, actions: flattenRoadmap(roadmap) }));
    if (currentRecordId.current) updateRecordRoadmap(currentRecordId.current, roadmap);
  }

  // 行动地图里的「做过 / 现实裁判 / 你写的反馈」写回存档：
  // 这样下一次炼金和下一次排路线，都能读到上一轮的真实结果（反哺闭环）
  function handleActionFeedback(feedback) {
    if (!currentRecordId.current) return;
    updateRecordActionFeedback(currentRecordId.current, feedback);
    setRecords(loadRecords());
  }

  // 本次要参考的「上一轮行动结果」（排除当前正在看的这条存档）
  const historyFeedback = useMemo(
    () => collectActionFeedback(records, currentRecordId.current),
    [records],
  );

  // 决策B「指出变化」：找出上一条带自测结果的历史存档，供行动地图对比"你判断变了没"
  const prevRecord = useMemo(() => {
    if (!records || !records.length) return null;
    const list = records.filter((r) => r.id !== currentRecordId.current && r.quiz && r.quiz.dominant);
    list.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
    return list[0] || null;
  }, [records, quizResult]);

  // 打开某条历史存档：把当时的处境卡与结果一起还原，像回到那天
  function openRecord(rec, destination = 'result0') {
    if (!rec || !rec.data) return;
    currentRecordId.current = rec.id;
    setCard(rec.card || null);
    setData(rec.data);
    // 导入到新设备的山径也能继续同一条待验证任务，不让联动只存在于原浏览器。
    if (rec.currentTask) saveRoad(rec.data, '__current', normalizeCurrentTask(rec.currentTask));
    setTopic(rec.topic || rec.data.topic || '');
    setQuizResult(rec.quiz || null);
    // 若当年生成过完整路线，直接还原，不重复消耗直答
    if (rec.data.roadmap) setPrefetchedActions({ roadmap: rec.data.roadmap, actions: flattenRoadmap(rec.data.roadmap) });
    else setPrefetchedActions(null);
    setVisitedResults(['result0', ...(rec.quiz ? ['result2'] : []), ...(rec.data.roadmap ? ['result3'] : [])]);
    go(destination === 'result3' && rec.quiz && canGenerateFullRoute(rec.quiz) ? 'result3' : destination);
  }

  function handleCurrentTaskChange(currentTask) {
    if (!currentTask) return;
    if (currentRecordId.current) updateRecordCurrentTask(currentRecordId.current, currentTask);
    setRecords(loadRecords());
  }

  // 页面解锁只看当前这一次自测；长期累计偏好不能让新一轮分析被误判为“已经答完”。
  const currentDominant = Array.isArray(quizResult?.dominant) ? quizResult.dominant : null;
  const currentDominantId = currentDominant?.[0] || '';
  const currentDominantCount = currentDominant?.[1] || 0;
  const domRole = currentDominantId && data ? (data.conflict?.roles || []).find((r) => r.id === currentDominantId) : null;
  const quizReady = canGenerateFullRoute(quizResult);

  function ResultHead({ back }) {
    return (
      <div className="result-head">
        <h2>山径图：{esc0(topic)}</h2>
        <div className="result-actions">
          {back && <button className="chip" onClick={() => go('result0')}>← 返回总览</button>}
          <button className="chip" onClick={() => { go('onboarding'); setData(null); setQuizResult(null); setVisitedResults([]); }}>← 重新建档</button>
          <button className="chip primary" onClick={() => exportMd({ ...data, roadmap: (prefetchedActions && prefetchedActions.roadmap) || data?.roadmap || null })}>导出 Markdown</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {step !== 'landing' && (
        <header className="topbar">
          <div><div className="brand">山外山</div><div className="brand-sub">不替你选路，只把众声摆成你能看清的山势</div></div>
          {step !== 'journal' && records.length > 0 && <button type="button" className="topbar-journal" onClick={() => go('journal')}>行动簿</button>}
        </header>
      )}

      <main className="container">
        {error && <div className="error-box" role="alert"><b>这次没走通：</b>{error}</div>}

        {step === 'landing' && (
          <Landing
            onStart={() => { setCarryoverChoice(null); go('onboarding'); }}
            records={records}
            onOpen={openRecord}
            onClear={() => {
              clearLocalData();
              setHistory(loadHistory());
              setRecords([]);
              currentRecordId.current = null;
            }}
            onExport={handleExportArchive}
            onImport={handleImportArchive}
            auth={auth}
            authConfig={authConfig}
            onLogin={startZhihuLogin}
            onSync={syncArchive}
            onOpenJournal={() => go('journal')}
            />
        )}

        {step === 'journal' && (
          <ActionJournal
            records={records}
            onBack={() => go('landing')}
            onOpenRecord={(record) => openRecord(record, 'result3')}
            onRecordsChange={(next) => setRecords(next || loadRecords())}
          />
        )}

        <SpiritGuide records={records} currentData={data} step={step} topic={topic} prompt={guidePrompt} />

        {step === 'onboarding' && (
          <div className="back-row">
            <button className="chip ghost" onClick={() => go('landing')}>← 返回山脚</button>
          </div>
        )}

        {step === 'onboarding' && (
          <Onboarding
            initial={card}
            onBuildCard={buildCard}
            history={history}
            onDraftChange={setCard}
            onQuestionComplete={(draft) => setGuidePrompt({
              id: `onboarding-details:${Date.now()}`,
              type: 'onboarding-details',
              question: draft.confusion.trim(),
            })}
          />
        )}

        {step === 'card' && card && (
          <>
            <MemoryCarryover candidates={carryoverCandidates} decision={carryoverChoice} onDecision={(value) => { setCarryoverChoice(value); if (value !== null) setError(null); }} />
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
          </>
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
            <div className="far-hills" aria-hidden="true" />
            <ResultNav
              current={step}
              onGoto={go}
              onEditCard={() => go('card')}
              quizDone={quizReady}
              visited={visitedResults}
              onOpenJournal={() => go('journal')}
            />
            {card && (
              <div className="persona-strip" aria-label="当前处境">
                <span className="ps-label">当前处境</span>
                <span className="ps-chip">{esc0(personaLabel(card))}</span>
                {card.confusion && <span className="ps-chip">最困惑：{esc0(card.confusion)}</span>}
                {card.timePressure && <span className="ps-chip">时间压力：{esc0(card.timePressure)}</span>}
              </div>
            )}
            {/* 模式标记：演示 / 真实兜底 / 真实检索，三种来源必须一眼分清，不能把示例内容当真实知乎内容。默认收起，点开才看细节 */}
            <div className={`source-meta-bar${metaOpen ? ' open' : ''}`}>
              <button className="chip ghost sm" onClick={() => setMetaOpen((o) => !o)}>
                {metaOpen ? '收起来源说明 ▲' : '来源说明 ▼'}
              </button>
              {metaOpen && (
                <div className="smb-detail">
                  {data.mock && (
                    <div className="mode-note demo">
                      🎭 <b>{data.quotaFallback ? '今日额度已到保护线' : '当前是演示数据'}</b>：{data.quotaFallback ? '为避免继续消耗比赛额度，已自动切到完整演示结果。你仍可走完整个流程。' : '这会儿还没接上知乎，下面是一套完整的示例流程；接上之后，就换成真实讨论。'}
                    </div>
                  )}
                  {!data.mock && data.fallback && (
                    <div className="mode-note fb">
                      🧭 <b>原始山径</b>：知乎直答这会儿没连上，下面都是<b>原样摆着的真实脚印</b>（没经过二次整理），哪些前提和你处境接近，你自己判断。
                    </div>
                  )}
                  {!data.mock && !data.fallback && (
                    <div className="mode-note live">
                      🔗 这次的内容来自<b>知乎站内和全网翻到的真实讨论</b>，由知乎直答按你的处境整理。
                    </div>
                  )}
                  {data.lowConfidence && (
                    <div className="low-confidence-note">
                      知乎上直接聊这个话题的高赞讨论不多，下面是相近主题的真实回答，先拿来垫一垫。重点看哪些前提和你处境接近，别照搬结论。
                    </div>
                  )}
                </div>
              )}
            </div>
            {step === 'result0' && (
              <ResultHub data={data} quizDone={quizReady} onGoto={go} />
            )}
            {step === 'result1' && (
              <>
                <ResultHead back />
                <ConflictWall conflict={data.conflict} persona={card} demo={!!data.mock} sourceStats={data.searchStats} roadData={data} onTaskChange={handleCurrentTaskChange} onNext={() => go('result2')} />
              </>
            )}
            {step === 'result2' && (
              <>
                <ResultHead back />
                {data.framework && (
                  <details className="card framework framework-collapsed">
                    <summary>答题前想多看一步？展开“辨山尺”</summary>
                    <p className="muted">它不是必读说明，而是当你拿不准该信谁时，用来检查来源、前提和适用边界。</p>
                    <ul>{data.framework.dimensions.map((x, i) => <li key={i}><b>{x.dim}：</b>{x.guide}</li>)}</ul>
                  </details>
                )}
                <Quiz
                  quiz={data.quiz}
                  roles={data.conflict?.roles}
                  onAnswer={onQuizAnswer}
                  onProgress={setQuizResult}
                  initialProgress={quizResult}
                  onGotoActions={() => go('result3')}
                  onNeedHelp={({ index, scenario }) => setGuidePrompt({
                    id: `quiz-help:${index}:${Date.now()}`,
                    type: 'quiz-help',
                    index,
                    scenario,
                  })}
                  currentTask={normalizeCurrentTask(loadRoad(data)?.__current) || null}
                />
              </>
            )}
            {step === 'result3' && (
              <>
                <ResultHead back />
                {routeConfidence(quizResult) === 'none' && (
                  <div className="dep-note">先在岔口站一站，我才能给你画出专属的脚下三步。</div>
                )}
                {routeConfidence(quizResult) === 'low' && (
                  <div className="dep-note">
                    已答 {quizResult.answeredCount}/{(data.quiz || []).length || 5} 题，还差 <b>{routeMissingCount(quizResult)}</b> 题，雾就还散不透——
                    下面这版是<b>雾里看山，先别当真</b>，只能给你垫一垫脚。
                  </div>
                )}
                {quizReady && currentDominantId && (
                  <div className="dominant muted">这一轮你更多从「<b>{esc0(viewpointAngle(domRole, (data.conflict?.roles || []).findIndex((r) => r.id === currentDominantId)))}</b>」作答（本轮 {currentDominantCount}/{quizResult.total} 题）</div>
                )}
                <ActionMap
                  data={data}
                  quizResult={quizResult}
                  persona={card}
                  prefetchedActions={prefetchedActions}
                  prevRecord={prevRecord}
                  historyFeedback={historyFeedback}
                  onRouteReady={handleRouteReady}
                  onFeedbackChange={handleActionFeedback}
                  onCurrentTaskChange={handleCurrentTaskChange}
                  onOpenJournal={() => go('journal')}
                />
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
