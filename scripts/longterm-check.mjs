// 长期化增强回归检查：检索权重（分开排名再合并）+ 历史存档
// 无外部依赖、不消耗任何接口额度，可直接 node 运行。
import { scoreItem, pickCorpus } from '../zhihu.js';
import { pruneRecords, normalizeRecord } from '../src/lib.js';

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('FAIL   ' + name); }
}

// 造数据：authority 实测为字符串 "2"/"3"/"4"；全网 voteUp/comment 恒为 0
const zh = (auth, vu, cm, title) => ({ title, summary: 's', url: 'u', voteUp: vu, comment: cm, authority: String(auth), author: 'a', type: 'Answer' });
const web = (auth, title) => ({ title, summary: 's', url: 'u', voteUp: 0, comment: 0, authority: String(auth), author: 'w', type: 'Web', source: 'web' });

console.log('# 打分 — 站内：权威等级为主，赞数评论加分');
ok(scoreItem(zh(4, 0, 0, 'A')) > scoreItem(zh(3, 0, 0, 'B')), '权威等级高的排前面');
ok(scoreItem(zh(4, 269, 5, 'A')) > scoreItem(zh(4, 14, 3, 'B')), '权威等级相同时，赞数高的排前面');
ok(scoreItem(zh(3, 500, 50, 'A')) > scoreItem(zh(3, 0, 0, 'B')), '同等级下高赞能拉开差距（269赞这类信号不被浪费）');

console.log('# 打分 — 全网：只看权威等级');
ok(scoreItem(web(4, 'X')) > scoreItem(web(2, 'Y')), '全网权威等级高的排前面');
ok(scoreItem(web(3, 'X')) === scoreItem(web(3, 'Y')), '全网同等级分数相同（赞数恒为0，不参与比较）');

console.log('# 关键：不跨源比赞数（否则全网恒为0会永久垫底）');
ok(scoreItem(web(4, 'X')) > scoreItem(zh(3, 0, 0, 'B')), '全网权威4 胜过 站内权威3且0赞');

console.log('# 选料 — 去重');
const r1 = pickCorpus([zh(3, 0, 0, '同一篇文章'), web(4, '同一篇文章')], 8);
ok(r1.corpus.length === 1, '标题重复只保留一条');

console.log('# 选料 — 冷门让位（知乎内容少，名额给全网）');
const cold = [zh(4, 10, 1, '站内唯一'), web(4, 'W1'), web(3, 'W2'), web(3, 'W3'), web(3, 'W4'), web(2, 'W5'), web(2, 'W6'), web(2, 'W7')];
const r2 = pickCorpus(cold, 8);
ok(r2.corpus.length === 8, '总数补满 8 条');
ok(r2.corpus.filter((x) => x.source === 'web').length >= 6, '站内只有1条时，多余名额让给全网');

console.log('# 选料 — 两边都充足时各占一半');
const rich = [
  zh(4, 300, 10, 'Z1'), zh(4, 200, 8, 'Z2'), zh(4, 100, 5, 'Z3'), zh(3, 50, 2, 'Z4'), zh(3, 20, 1, 'Z5'), zh(3, 10, 0, 'Z6'),
  web(4, 'W1'), web(4, 'W2'), web(3, 'W3'), web(3, 'W4'), web(2, 'W5'), web(2, 'W6'),
];
const r3 = pickCorpus(rich, 8);
ok(r3.corpus.filter((x) => x.source !== 'web').length === 4, '知乎取 4 条');
ok(r3.corpus.filter((x) => x.source === 'web').length === 4, '全网取 4 条');

console.log('# 存档 — 上限淘汰');
const many = Array.from({ length: 35 }, (_, i) => ({ id: 'r' + (i + 1), ts: i + 1, v: 1, topic: 't' + (i + 1) }));
const pruned = pruneRecords(many, 30);
ok(pruned.length === 30, '超过 30 条只保留 30 条');
ok(pruned[0].ts === 35, '保留最新的，最旧的被淘汰');

console.log('# 存档 — 旧版本兼容（以后改格式，老存档不能打不开）');
const norm = normalizeRecord({ topic: '老存档', data: { conflict: { roles: [] } } });
ok(norm.v === 1, '旧存档自动补上格式版本号');
ok(typeof norm.ts === 'number', '旧存档自动补上时间戳');
ok(norm.topic === '老存档', '旧存档内容保留');

console.log('\n' + (fail ? 'FAILED' : 'ALL PASS') + `  pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
