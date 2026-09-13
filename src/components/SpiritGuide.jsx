import React, { useState, useRef, useEffect, useCallback } from 'react';
import { api, recordToText } from '../lib.js';
import { journalSummary } from '../journal.js';
import './spirit.css';

// 刘看山的官方透明 GIF 动图（放在 public/liukanshan/，构建时随 dist 一起托管）
const GIF = {
  idle: '待机_5秒_320x320_20fps_透明.gif',
  greet: '打招呼_4秒_320x320_20fps_透明.gif',
  typing: '电脑_6秒_320x320_20fps_透明.gif',
  sway: '晃悠_320x320_3秒_20fps_透明.gif',
  sleep: '瞌睡_5秒_320x320_20fps_透明.gif',
  ball: '运球_4秒_320x320_20fps_透明.gif',
};
const gif = (f) => '/liukanshan/' + encodeURIComponent(f);

const GREET = '你好，我是刘看山，陪你翻山的伙伴。你可以问我过去的山径记录，也可以继续聊眼前的求职判断。';

export default function SpiritGuide({ records = [], currentData = null, step = 'landing', prompt = null }) {
  const [open, setOpen] = useState(false);
  const [anim, setAnim] = useState('idle');
  const [bubble, setBubble] = useState(null); // 主动冒泡的一句话
  const [messages, setMessages] = useState([{ role: 'assistant', content: GREET }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const firedRef = useRef({}); // 记录已触发的节点，避免重复冒泡
  const bubbleTimerRef = useRef(null);
  const journal = journalSummary(records);

  const hideBubble = useCallback(() => {
    window.clearTimeout(bubbleTimerRef.current);
    setBubble(null);
    setAnim('idle');
  }, []);

  const showBubble = useCallback((next, duration = 7500) => {
    window.clearTimeout(bubbleTimerRef.current);
    setBubble(next);
    setAnim('greet');
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubble(null);
      setAnim('idle');
    }, duration);
  }, []);

  useEffect(() => () => window.clearTimeout(bubbleTimerRef.current), []);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  }, [messages, open]);

  // 三处关键节点主动冒泡（其余时间安静待机，不烦人）
  useEffect(() => {
    const key = step + ':' + (records.length || 0);
    if (firedRef.current[key]) return;
    let text = null;
    if (step === 'landing' && records.length === 0) {
      text = '第一次来呀？先标记你的位置，我陪你炼出第一个炼金包吧～ 点我随时聊。';
    } else if (step === 'landing' && journal.waiting > 0) {
      text = `你带回的现实里有 ${journal.waiting} 条新脚印，正在行动簿等你确认。确认前，我不会把它们当成你的新结论。`;
    } else if (step === 'result0') {
      text = '山径图画好了。先从“听不同声音”开始，再做自测，最后才排你的行动路线。';
    } else if (step === 'result3') {
      text = '路线排好了。先只打开第一段，做完再看后面，不用一次背完整座山。';
    }
    if (text) {
      firedRef.current[key] = true;
      showBubble({ text });
    }
  }, [step, records.length, journal.waiting, showBubble]);

  // 用户完成核心问题后再提示补充信息。延迟出现，避免和输入动作抢注意力。
  useEffect(() => {
    if (step !== 'onboarding' || !prompt?.id || prompt.type !== 'onboarding-details') return undefined;
    const key = `prompt:${prompt.id}`;
    if (firedRef.current[key]) return undefined;
    firedRef.current[key] = true;
    const delay = window.setTimeout(() => {
      const details = document.getElementById('onboarding-more');
      if (details?.open) return;
      showBubble({
        kind: 'onboarding-details',
        text: '问题已经很清楚了。再补充目标城市或具体方向，观点会更贴近你的处境。',
      }, 10000);
    }, 900);
    return () => window.clearTimeout(delay);
  }, [prompt, showBubble, step]);

  useEffect(() => {
    if (step !== 'result2' || !prompt?.id || prompt.type !== 'quiz-help') return;
    const key = `prompt:${prompt.id}`;
    if (firedRef.current[key]) return;
    firedRef.current[key] = true;
    showBubble({ kind: 'quiz-help', text: '还没头绪也正常。要不要把这题拆成两个更容易判断的小问题？', scenario: prompt.scenario }, 12000);
  }, [prompt, showBubble, step]);

  // 打开时切到打招呼动画，关闭回到待机
  useEffect(() => {
    if (open) {
      window.clearTimeout(bubbleTimerRef.current);
      setBubble(null);
      setAnim('greet');
    }
    else setAnim('idle');
  }, [open]);

  function openOnboardingDetails() {
    const details = document.getElementById('onboarding-more');
    if (details) {
      details.open = true;
      details.classList.remove('guide-highlight');
      requestAnimationFrame(() => {
        details.classList.add('guide-highlight');
        details.scrollIntoView({ behavior: 'smooth', block: 'center' });
        details.querySelector('summary')?.focus();
      });
      window.setTimeout(() => details.classList.remove('guide-highlight'), 1400);
    }
    hideBubble();
  }

  function openQuizHelp() {
    const scenario = bubble?.scenario || prompt?.scenario || '这道题';
    setMessages((current) => [...current, { role: 'assistant', content: `先不用急着选。面对“${scenario}”，只看两件事：哪条说法的前提最像你现在的处境；哪条说法能被你用一个真实岗位或一次沟通验证。如果两件事都答不上，保留“不确定”就是有效答案。` }]);
    hideBubble();
    setOpen(true);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    setAnim('typing');
    try {
      // 知识库 = 历史炼金包 + 当前正在看的炼金包（懂场景）
      const kb = (records || []).map((r) => ({ ts: r.ts, topic: r.topic || r.data?.topic || '', text: recordToText(r) }));
      if (currentData && currentData.topic) {
        kb.unshift({ ts: Date.now(), topic: '【当前正在看】' + (currentData.topic || ''), text: recordToText({ data: currentData }) });
      }
      const data = await api('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, kb }),
      });
      setMessages((m) => [...m, { role: 'assistant', content: data.reply || '（这句我没接住，换个问法试试）' }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: '没接上：' + (e.message || '请求失败') }]);
    } finally {
      setLoading(false);
      setAnim('idle');
    }
  }

  return (
    <>
      {bubble && !open && (
        <aside className={`spirit-bubble${bubble.kind ? ` ${bubble.kind}` : ''}`} role="status" aria-live="polite">
          <span className="spirit-bubble-copy">{bubble.text}</span>
          {bubble.kind === 'onboarding-details' && (
            <span className="spirit-bubble-actions">
              <button type="button" className="spirit-bubble-primary" onClick={openOnboardingDetails}>补充路标</button>
              <button type="button" className="spirit-bubble-dismiss" onClick={hideBubble}>暂时不用</button>
            </span>
          )}
          {bubble.kind === 'quiz-help' && (
            <span className="spirit-bubble-actions">
              <button type="button" className="spirit-bubble-primary" onClick={openQuizHelp}>帮我拆开</button>
              <button type="button" className="spirit-bubble-dismiss" onClick={hideBubble}>先保留不确定</button>
            </span>
          )}
        </aside>
      )}
      <button className="spirit-fab" aria-label="刘看山" onClick={() => setOpen((o) => !o)}>
        <img src={gif(GIF[anim] || GIF.idle)} alt="刘看山" width="96" height="96" decoding="async" className="spirit-gif" />
      </button>

      {open && (
        <section className="spirit-panel" aria-label="刘看山对话">
          <header className="spirit-head">
            <img src={gif(GIF.greet)} alt="" width="42" height="42" loading="lazy" decoding="async" className="spirit-head-gif" />
            <div className="spirit-id">
              <div className="spirit-name">刘看山</div>
              <div className="spirit-sub muted">陪你翻山的伙伴</div>
            </div>
            <button className="chip ghost" onClick={() => setOpen(false)}>收起</button>
          </header>

          <div className="spirit-body">
            {messages.map((m, i) => (
              <div key={i} className={`spirit-msg ${m.role}`}>
                <div className="spirit-bubble-txt">{m.content}</div>
              </div>
            ))}
            {loading && <div className="spirit-msg assistant"><div className="spirit-bubble-txt muted">思考中…</div></div>}
            <div ref={endRef} />
          </div>

          <div className="spirit-input">
            <textarea
              aria-label="向刘看山提问"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={currentData ? '问当前这个炼金包，或任何判断问题…（Enter 发送）' : '问问你过去的炼金包，或任何判断问题…（Enter 发送）'}
            />
            <button className="primary" onClick={send} disabled={loading || !input.trim()}>发送</button>
          </div>
          <div className="spirit-foot muted">
            {records.length ? `你炼过 ${records.length} 个炼金包` : '还没炼过，先炼一个吧'}{currentData ? ' · 我正看着你眼前这一个' : ''}
          </div>
        </section>
      )}
    </>
  );
}
