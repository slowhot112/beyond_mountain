import React from 'react';
import LogicChain from './LogicChain.jsx';

const LABELS = {
  card: '路标',
  result0: '山径图',
  result1: '众声对照',
  result2: '辨向自测',
  result3: '脚下三步',
};

// 结果页常驻导航：随时修改简历卡 + 五步逻辑链主线
export default function ResultNav({ current, onGoto, onEditCard, quizDone }) {
  return (
    <nav className="result-nav" aria-label="结果页导航">
      <div className="result-nav-top">
        <button className="chip ghost nav-edit" onClick={onEditCard}>调整路标</button>
        <span className="nav-sub">当前在 <b>{LABELS[current] || ''}</b> · 点任意模块自由进出</span>
      </div>
      <LogicChain current={current} onGoto={onGoto} quizDone={quizDone} />
    </nav>
  );
}
