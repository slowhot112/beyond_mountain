import React from 'react';
import LogicChain from './LogicChain.jsx';

const LABELS = {
  card: '山脚',
  result0: '观山台',
  result1: '听回声',
  result2: '岔口',
  result3: '行动路线',
};

// 结果页常驻导航：随时修改简历卡 + 五步逻辑链主线
export default function ResultNav({ current, onGoto, onEditCard, quizDone, visited }) {
  return (
    <nav className="result-nav" aria-label="结果页导航">
      <div className="result-nav-top">
        <button className="chip ghost nav-edit" onClick={onEditCard}>调整路标</button>
        <span className="nav-sub">当前在 <b>{LABELS[current] || ''}</b> · 建议顺着山径走，也可返回看过的页面</span>
      </div>
      <LogicChain current={current} onGoto={onGoto} quizDone={quizDone} visited={visited} />
    </nav>
  );
}
