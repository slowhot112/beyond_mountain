import React, { useState, useRef, useEffect } from 'react';
import { api, recordToText } from '../lib.js';
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

const GREET = '你好，我是刘看山，陪你翻山的伙伴。你可以问我你之前炼过的炼金包，或者任何求职判断的问题——我会参考你过去的分析来回答。';

export default function SpiritGuide({ records = [], currentData = null, step = 'landing', topic = '' }) {
  const [open, setOpen] = useState(false);
  const [anim, setAnim] = useState('idle');
  const [bubble, setBubble] = useState(null); // 主动冒泡的一句话
  const [messages, setMessages] = useState([{ role: 'assistant', content: GREET }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const firedRef = useRef({}); // 记录已触发的节点，避免重复冒泡

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);

  // 三处关键节点主动冒泡（其余时间安静待机，不烦人）
  useEffect(() => {
    const key = step + ':' + (records.length || 0);
    if (firedRef.current[key]) return;
    let text = null;
    if (step === 'landing' && records.length === 0) {
      text = '第一次来呀？先标记你的位置，我陪你炼出第一个炼金包吧～ 点我随时聊。';
    } else if (step === 'result0') {
      text = '这是你的山径图。先登台俯瞰整片山势，有问题随时找我。';
    } else if (step === 'result3') {
      text = '脚下三步排好了，先从“今天”那一步迈起，别等到下周。';
    }
    if (text) {
      firedRef.current[key] = true;
      setBubble(text);
      setAnim('greet');
      setTimeout(() => { if (!open) setBubble(null); }, 6500);
    }
  }, [step, records.length, open]);

  // 打开时切到打招呼动画，关闭回到待机
  useEffect(() => {
    if (open) { setAnim('greet'); setBubble(null); }
    else setAnim('idle');
  }, [open]);

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
      setMessages((m) => [...m, { role: 'assistant', content: data.reply || '（无回复）' }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: '出错了：' + (e.message || '请求失败') }]);
    } finally {
      setLoading(false);
      setAnim('idle');
    }
  }

  return (
    <>
      <button className="spirit-fab" aria-label="刘看山" onClick={() => setOpen((o) => !o)}>
        <img src={gif(GIF[anim] || GIF.idle)} alt="刘看山" className="spirit-gif" />
        {bubble && !open && <span className="spirit-bubble">{bubble}</span>}
      </button>

      {open && (
        <section className="spirit-panel" aria-label="刘看山对话">
          <header className="spirit-head">
            <img src={gif(GIF.greet)} alt="" className="spirit-head-gif" />
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
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={currentData ? '问当前这个炼金包，或任何判断问题…（Enter 发送）' : '问问你过去的炼金包，或任何判断问题…（Enter 发送）'}
            />
            <button className="primary" onClick={send} disabled={loading || !input.trim()}>发送</button>
          </div>
          <div className="spirit-foot muted">
            {records.length ? `知识库含 ${records.length} 个炼金包` : '知识库暂空，先去炼一个吧'}{currentData ? ' · 已带入当前炼金包' : ''}
          </div>
        </section>
      )}
    </>
  );
}
