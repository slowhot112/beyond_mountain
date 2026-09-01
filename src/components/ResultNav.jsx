import React from 'react';
import LogicChain from './LogicChain.jsx';

const LABELS = {
  card: '处境卡',
  result0: '炼金包',
  result1: '主流观点',
  result2: '判断力自测',
  result3: '行动地图',
};

// 结果页常驻导航：随时修改简历卡 + 五步逻辑链主线
export default function ResultNav({ current, onGoto, onEditCard, quizDone }) {
  return (
    <nav className="result-nav" aria-label="结果页导航">
      <div className="result-nav-top">
        <button className="chip ghost nav-edit" onClick={onEditCard}>修改简历卡</button>
        <span className="nav-sub">炼金五步 · 当前：<b>{LABELS[current] || ''}</b></span>
      </div>
      <LogicChain current={current} onGoto={onGoto} quizDone={quizDone} />
    </nav>
  );
}
