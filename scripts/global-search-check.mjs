#!/usr/bin/env node
// 全网搜接入回归断言（零外部依赖，mock fetch 不消耗真实额度）
// 验证：1) 无 Secret 时不触接口、安全返回空；2) global_search 字段解析 + source 标记 + url 兜底；
//       3) alchemy 双路检索后来源同时含站内与全网（证明全网搜已真正接入语料）。
import * as zhihu from '../zhihu.js';

// ---- mock fetch：按 URL 区分三个接口 ----
const ZHIHU_ITEMS = [
  { Title: '站内：AI 求职怎么选', ContentText: '站内高赞观点摘要', Url: 'https://www.zhihu.com/q/zs', VoteUpCount: 3000, CommentCount: 100, AuthorityLevel: '3', AuthorName: '知乎答主', ContentType: 'Answer' },
];
const WEB_ITEMS = [
  { Title: '全网：AI 行业报告', ContentText: '全网视角摘要', Url: 'https://example.com/report', AuthorName: '某媒体', ContentType: 'Web' },
  { Title: '全网：无 URL 来源', ContentText: '没有链接的全网内容', AuthorName: '某博客' },
];
const ZHIDA_JSON = JSON.stringify({
  topic: 'AI 求职',
  conflict: { summary: '分歧', roles: [
    { id: 'r1', name: '派A', form: 'x', avatar: '🐻‍❄️', persona: 'p', stance: 's', coreArg: 'c', bestFor: 'b', boundary: 'bd', matchReason: 'm', sources: ['来源1'], rebuts: [] },
    { id: 'r2', name: '派B', form: 'y', avatar: '🐻‍❄️', persona: 'p2', stance: 's2', coreArg: 'c2', bestFor: 'b2', boundary: 'bd2', matchReason: 'm2', sources: ['来源2'], rebuts: [] },
  ] },
  framework: { title: 't', dimensions: [] },
  quiz: Array.from({ length: 5 }, (_, i) => ({
    scenario: `q${i + 1}`, options: [{ label: 'a', side: 'r1' }, { label: 'b', side: 'r2' }, { label: '?', side: null }],
    prompt: 'p', feedback: 'f', analysis: 'a',
  })),
  actions: [{ task: 't1', why: 'w' }, { task: 't2', why: 'w' }, { task: 't3', why: 'w' }],
});

globalThis.fetch = async (url) => {
  const u = String(url);
  let body;
  if (u.includes('global_search')) body = { Data: { Items: WEB_ITEMS } };
  else if (u.includes('zhihu_search')) body = { Data: { Items: ZHIHU_ITEMS } };
  else if (u.includes('chat/completions')) body = { choices: [{ message: { content: ZHIDA_JSON } }] };
  else body = {};
  return { ok: true, status: 200, async text() { return JSON.stringify(body); }, async json() { return body; } };
};

const results = [];
function check(name, pass, detail = '') { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); }

// A. 无 secret 时不触接口、直接返回空（安全）
const empty = await zhihu.zhihuGlobalSearch('', 'AI', 4);
check('无 Secret 时全局搜返回空数组（不泄露/不报错）', Array.isArray(empty) && empty.length === 0, `len=${empty.length}`);

// B. 解析 + 字段对齐 + source 标记 + url 兜底
const g = await zhihu.zhihuGlobalSearch('FAKE_SECRET', 'AI 求职', 4);
check('全局搜解析出条目', g.length === WEB_ITEMS.length, `len=${g.length}`);
check('全局搜条目带 source:"web"', g.every((it) => it.source === 'web'));
check('全局搜条目有 title/summary', g.every((it) => it.title && it.summary));
const noUrlItem = g.find((it) => !WEB_ITEMS.find((w) => w.Title === it.title)?.Url);
check('全局搜无 URL 时兜底为知乎搜索链接', !noUrlItem || noUrlItem.url.includes('zhihu.com/search'), noUrlItem?.url);

// C. alchemy 双路检索：来源同时含站内与全网
const persona = { identityName: '准入行', industryName: 'AI', subName: 'AIGC', goalNames: ['求职'], city: '北京', timePressure: '三个月', confusion: '怎么选' };
const al = await zhihu.alchemy('FAKE_SECRET', 'AI 求职', persona, ['AI 求职']);
const src = al.sources || [];
check('alchemy 来源数量 ≥2', src.length >= 2, `len=${src.length}`);
check('alchemy 来源同时含站内与全网（全网搜已接入）',
  src.some((s) => s.source === 'web') && src.some((s) => s.source !== 'web'),
  `sources=${JSON.stringify(src.map((s) => s.source || 'zhihu'))}`);
check('alchemy 返回 ≥2 个角色', (al.conflict?.roles || []).length >= 2, `roles=${(al.conflict?.roles || []).length}`);

const fails = results.filter((x) => !x).length;
console.log(`\n== 全网搜回归：${results.length - fails} 通过 / ${fails} 失败 ==`);
process.exitCode = fails ? 1 : 0;
