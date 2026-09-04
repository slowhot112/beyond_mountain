import React, { useState, useRef, useEffect } from 'react';
import { api, recordToText } from '../lib.js';

// 知识库对话（轻量 RAG）：把历史炼金包作为知识库上下文，AI 引用它来回答。
// 不依赖外部向量库——每次把历史压成文本塞进 prompt，先把"知识库"概念跑通。
export default function Chat({ records = [], onBack }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '你好，我是山外山的小助手。你可以问我你之前炼过的炼金包，或者任何求职判断相关的问题——我会参考你过去的分析来回答。' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
        <h2>知识库对话</h2>
        <button className="chip ghost" onClick={onBack}>← 返回我的地盘</button>
      </div>
      <p className="muted chat-sub">
        AI 会参考你历史炼金包来回答（轻量 RAG）。当前知识库含 {records.length} 个炼金包。
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="问问你过去的炼金包，或任何判断相关的问题…（Enter 发送 / Shift+Enter 换行）"
        />
        <button className="primary" onClick={send} disabled={loading || !input.trim()}>发送</button>
      </div>
    </section>
  );
}
