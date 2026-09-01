import React from 'react';

// 炼金主线：处境卡 → 炼金包（总览）→ 主流观点 → 判断力自测（含信谁框架）→ 行动地图
const NODES = [
  { key: 'card', label: '处境卡', step: 'card' },
  { key: 'hub', label: '炼金包', step: 'result0' },
  { key: 'wall', label: '主流观点', step: 'result1' },
  { key: 'quiz', label: '判断力自测', step: 'result2' },
  { key: 'action', label: '行动地图', step: 'result3' },
];

// 把当前 step 映射到逻辑链的“当前节点”序号
function currentIndex(step) {
  if (step === 'card') return 0;
  if (step === 'result0') return 1;
  if (step === 'result1') return 2;
  if (step === 'result2') return 3;
  if (step === 'result3') return 4;
  return -1;
}

export default function LogicChain({ current, onGoto, quizDone }) {
  const ci = currentIndex(current);
  return (
    <ol className="logic-chain" aria-label="炼金五步逻辑链">
      {NODES.map((n, i) => {
        const state = i < ci ? 'done' : i === ci ? 'current' : 'upcoming';
        const locked = n.key === 'action' && !quizDone; // 行动地图依赖自测
        return (
          <React.Fragment key={n.key}>
            <li
              className={`lc-node ${state}${locked ? ' locked' : ''}`}
              onClick={() => !locked && onGoto(n.step)}
              aria-current={state === 'current' ? 'step' : undefined}
              title={locked ? '需先完成判断力自测' : n.label}
            >
              <span className="lc-dot">{i + 1}</span>
              <span className="lc-label">{n.label}</span>
              {locked && <span className="lc-warn">需先完成自测</span>}
            </li>
            {i < NODES.length - 1 && <span className="lc-line" aria-hidden="true" />}
          </React.Fragment>
        );
      })}
    </ol>
  );
}
