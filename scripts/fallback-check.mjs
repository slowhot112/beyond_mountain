#!/usr/bin/env node
// 兜底内容回归断言（直答失败时的真实数据兜底）
// 针对已修的两个体验问题：
//   1) 最强论点 / 自测题干曾把整篇知乎原文拍在用户脸上 → 必须被截断
//   2) 自测选项曾只有「认同 / 警惕」且两个选项 side 相同 → 必须覆盖各派 + 一个「不确定」
// 零外部依赖：直接 import 后端 realDataFallback，构造模拟搜索结果，不消耗任何知乎额度。
import { realDataFallback } from '../zhihu.js';

const LONG = '薛天帆也分享了自己的思考：如何把当前的感知系统与世界模型等预测系统融合，做“预测性感知”，'
  + '比如视觉、触觉底层信号的感知。他举了个神经学上的经典例子——人有时会“幻觉”口袋里的手机震了，'
  + '其实是因为大脑会预先预测接下来要发生什么，「如果未来的事情跟现实对齐了就 ok，没对齐就会出现奇怪的情况」。'
  + '「怎么把现在的这种感知的系统跟预测系统能够融合在一起，去做一个预测性感知，我觉得这对未来包括 robotics、'
  + '提升整个智能系统的感知能力，是一件很重要的事。」';

const items = [
  { title: '继续深造还是进大厂？几位老师给了真心话', url: 'https://www.zhihu.com/p/1', summary: LONG, author: '将门创投', voteUp: 3120 },
  { title: '大三申请博士是为了去大厂还是做教职', url: 'https://www.zhihu.com/p/2', summary: LONG + '后面还有很长很长的一段内容，用来验证截断逻辑是否真的生效。', author: '知乎用户', voteUp: 1800 },
  { title: 'AI 研究职业圈子正在 quant 化', url: 'https://www.zhihu.com/p/3', summary: LONG, author: '成宇', voteUp: 900 },
];
const pt = {
  identityName: '在校探索', goalNames: ['升学与就业决策'], city: '北京',
  timePressure: '三个月', industryName: 'AI', subName: '算法',
};

const out = realDataFallback(items, '继续深造还是进大厂', pt);

const results = [];
function check(name, pass, detail = '') {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const quiz = out.quiz || [];
const roles = out.conflict?.roles || [];

check('quiz 共 5 题', quiz.length === 5, `quiz=${quiz.length}`);
const optCounts = quiz.map((q) => (q.options || []).length);
check('每题 options ≥3（各派 + 不确定）', optCounts.length > 0 && optCounts.every((n) => n >= 3),
  `options=${JSON.stringify(optCounts)}`);
check('每题都有 side=null 的「不确定」选项',
  quiz.every((q) => (q.options || []).some((o) => o.side === null)));
check('选项 side 覆盖多个角色（不再是两个同 side 的认同/警惕）',
  quiz.every((q) => new Set((q.options || []).map((o) => o.side).filter(Boolean)).size >= 2),
  `第1题 sides=${JSON.stringify((quiz[0]?.options || []).map((o) => o.side))}`);

const maxScenario = Math.max(...quiz.map((q) => (q.scenario || '').length));
check('题干长度 ≤120（不再整段原文拍脸上）', maxScenario <= 120, `maxScenario=${maxScenario}`);
const maxOpt = Math.max(...quiz.flatMap((q) => (q.options || []).map((o) => (o.label || '').length)));
check('选项标签长度 ≤30（不再一整行塞不下）', maxOpt <= 30, `maxOptionLabel=${maxOpt}`);
const maxCore = Math.max(...roles.map((r) => (r.coreArg || '').length));
check('最强论点长度 ≤125', maxCore <= 125, `maxCoreArg=${maxCore}`);
check('角色名用文章观点摘要、作者退为副标题',
  roles.length > 0 && roles.every((r) => r.name && r.name !== r.form),
  roles.map((r) => `${r.name}/${r.form}`).join(' , '));
check('行动地图 3~5 条且带城市/时间限定',
  (out.actions || []).length >= 3 && (out.actions || []).length <= 5
    && out.actions.some((a) => a.task.includes('北京') || a.task.includes('三个月')),
  `actions=${(out.actions || []).length}`);

// 来源去重：items 数量足够时，不同角色的 sourceItems url 不应重复
const urls = roles.flatMap((r) => (r.sourceItems || []).map((it) => it.url));
const hasDup = urls.some((u, i) => urls.indexOf(u) !== i);
check('不同角色引用的来源不重复（items 足够时）', !hasDup, JSON.stringify(urls));

// 知乎内容不足时的低置信提示
const lowOut = realDataFallback(items.slice(0, 1), '继续深造还是进大厂', pt);
check('内容不足时标记 lowConfidence', lowOut.lowConfidence === true, `lowConfidence=${lowOut.lowConfidence}`);
check('内容不足时 summary 给出诚实提示', (lowOut.conflict?.summary || '').includes('直接相关'), lowOut.conflict?.summary);

// 行动地图按时间压力变化
const timeCases = [
  { tp: '', want: '明确你的时间窗口', label: '未填时间' },
  { tp: '一周内', want: '2 小时内', label: '短于一星期' },
  { tp: '一个月', want: '本周内', label: '一个月左右' },
  { tp: '三个月以上', want: '本周内', label: '三个月以上' },
];
for (const tc of timeCases) {
  const tOut = realDataFallback(items, '继续深造还是进大厂', { ...pt, timePressure: tc.tp });
  const tasks = (tOut.actions || []).map((a) => a.task).join(' ');
  check(`时间压力「${tc.label}」时任务含「${tc.want}」`, tasks.includes(tc.want), `tasks=${tasks.slice(0, 120)}`);
}

console.log('\n--- 第 1 题预览 ---');
console.log(quiz[0]?.scenario);
(quiz[0]?.options || []).forEach((o) => console.log(`  - ${o.label}  (side=${o.side})`));
console.log('\n--- 角色预览 ---');
roles.forEach((r) => console.log(`  ${r.name} | ${r.form} | coreArg=${(r.coreArg || '').length}字`));

const fails = results.filter((x) => !x).length;
console.log(`\n== 结果：${results.length - fails} 通过 / ${fails} 失败 ==`);
process.exitCode = fails ? 1 : 0;
