import React, { useState, useRef, useEffect } from 'react';
import { api, recordToText } from '../lib.js';

// 知识库对话（轻量 RAG）：把历史炼金包作为知识库上下文，AI 引用它来回答。
// 不依赖外部向量库——每次把历史压成文本塞进 prompt，先把"知识库"概念跑通。
export default function Chat({ records = [], onBack }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '你好，我是山外山的小助手。你可以问我走过的山径，或者任何求职判断相关的问题。我会参考你过去确认过的判断来回答。' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      // 仅发送精炼后的知识库文本，避免完整 data 过大
      const kb = records.map((r) => ({ ts: r.ts, topic: r.topic || r.data?.topic || '', text: recordToText(r) }));
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
    }
  }

  return (
    <section className="card chat">
      <div className="chat-head">
        <h2>聊聊你走过的路</h2>
        <button className="chip ghost" onClick={onBack}>← 返回我的地盘</button>
      </div>
      <p className="muted chat-sub">
        我会参考你过去确认过的判断来回答。行动簿里已有 {records.length} 段山径。
      </p>

      <div className="chat-body">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="chat-msg assistant"><div className="chat-bubble muted">思考中…</div></div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-input">
        <textarea
          aria-label="向山外山助手提问"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="问问你走过的山径，或任何判断相关的问题…（Enter 发送 / Shift+Enter 换行）"
        />
        <button className="primary" onClick={send} disabled={loading || !input.trim()}>发送</button>
      </div>
    </section>
  );
}
