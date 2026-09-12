// 界面联动回归测试：自测 → 行动地图 → 下次炼金 / 历史记录
// 覆盖：答题门槛、自测结果传入行动接口、行动完成状态与反馈保存、下次炼金读取上轮结果、历史显示路线变化
// 运行：node scripts/linkage-check.mjs

// 极简 localStorage 模拟（lib.js 的存储函数只用到 getItem/setItem）
class LS {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
globalThis.localStorage = new LS();

const lib = await import('../src/lib.js');
const zhihu = await import('../zhihu.js');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------- 1. 未完成 4 道题时不能生成完整路线 ----------
check('答 0 题：置信度 none，不可生成完整路线',
  lib.routeConfidence({ answeredCount: 0, total: 5 }) === 'none'
  && lib.canGenerateFullRoute({ answeredCount: 0, total: 5 }) === false);
check('答 1 题：低置信度，不可生成完整路线',
  lib.routeConfidence({ answeredCount: 1, total: 5 }) === 'low'
  && lib.canGenerateFullRoute({ answeredCount: 1, total: 5 }) === false);
check('答 3 题：仍不足门槛（还差 1 题），不可生成完整路线',
  lib.routeConfidence({ answeredCount: 3, total: 5 }) === 'low'
  && lib.canGenerateFullRoute({ answeredCount: 3, total: 5 }) === false
  && lib.routeMissingCount({ answeredCount: 3, total: 5 }) === 1);

// ---------- 2. 完成 4 道题后可以生成路线 ----------
check('答 4/5 题：达到门槛，可生成完整路线（partial）',
  lib.routeConfidence({ answeredCount: 4, total: 5 }) === 'partial'
  && lib.canGenerateFullRoute({ answeredCount: 4, total: 5 }) === true);
check('答满 5/5 题：full，可生成完整路线',
  lib.routeConfidence({ answeredCount: 5, total: 5 }) === 'full'
  && lib.canGenerateFullRoute({ answeredCount: 5, total: 5 }) === true);

// ---------- 3. 自测结果确实传入行动接口 ----------
const quizResult = {
  sideCounts: { r1: 3, r2: 1 },
  uncertainSides: ['r2'],
  answeredCount: 4,
  total: 5,
  dominant: ['r1'],
};
const data = {
  topic: '双非大三要不要转数据分析',
  conflict: { roles: [{ id: 'r1', name: '实干派' }, { id: 'r2', name: '谋略派' }] },
  sources: [{ title: 's1' }, { title: 's2' }],
};
const payload = lib.buildActionsPayload({
  data,
  quizResult,
  persona: { city: '上海' },
  sources: data.sources,
  feedback: [],
  manual: false,
});
check('行动接口请求体包含完整自测结果（dominant/盲区/答题数）',
  payload.quizResult
  && payload.quizResult.answeredCount === 4
  && payload.quizResult.dominant[0] === 'r1'
  && payload.quizResult.uncertainSides.includes('r2'),
  `answeredCount=${payload.quizResult?.answeredCount}`);
check('行动接口请求体同时带上处境、角色与真实来源',
  payload.persona.city === '上海'
  && payload.roles.length === 2
  && payload.sources.length === 2
  && payload.topic === data.topic);

// ---------- 4. 行动完成状态与反馈能保存 ----------
const rec = lib.saveRecord({ card: { confusion: data.topic }, data, quiz: quizResult });
check('炼金存档写入成功', !!rec && !!rec.id, rec && rec.id);

const privateRec = lib.saveRecord({
  card: { confusion: '隐私测试', name: '张三', phone: '13800000000', email: 'a@example.com', resumeFields: { name: '张三' }, education: '计算机本科' },
  data: { topic: '隐私测试' }, quiz: null,
});
check('本地存档会移除姓名、电话、邮箱和完整简历字段',
  privateRec && !('name' in privateRec.card) && !('phone' in privateRec.card) && !('email' in privateRec.card)
  && !('resumeFields' in privateRec.card) && privateRec.card.education === '计算机本科');
localStorage.setItem('alchemy:records', JSON.stringify([rec]));

// 模拟用户在行动地图里勾选、裁判、写反馈
lib.saveRoad(data, 'p0t0', { done: true, verdict: 'up', hypothesis: '岗位门槛是否卡学历', note: '投了 8 份，2 个回复' });
lib.saveRoad(data, 'p0t1', { done: true, verdict: 'down', hypothesis: '先考证再求职是否更快' });
lib.saveRoad(data, 'p1t0', { done: true, verdict: 'unclear' });
lib.saveRoad(data, '__current', { started: true, startedAt: 1700000000000 });
const roadState = lib.loadRoad(data);
check('当前验证任务“已开始”状态可在刷新后恢复',
  roadState.__current?.started === true && roadState.__current?.startedAt === 1700000000000);
const fb = lib.summarizeActionFeedback(roadState);
check('行动完成状态与反馈被汇总（做过 3 步 / 属实 1 / 打脸 1 / 待定 1）',
  fb.done === 3 && fb.up.length === 1 && fb.down.length === 1 && fb.unclear.length === 1,
  `done=${fb.done} up=${fb.up.length} down=${fb.down.length} unclear=${fb.unclear.length}`);
check('用户手写的现实反馈被保留', fb.notes.length === 1 && fb.notes[0].note === '投了 8 份，2 个回复');

lib.updateRecordActionFeedback(rec.id, fb);
const saved = lib.loadRecords().find((r) => r.id === rec.id);
check('行动结果写回存档（下次可读）',
  !!saved && !!saved.actionFeedback && saved.actionFeedback.down.length === 1,
  saved && saved.actionFeedback ? `down=${saved.actionFeedback.down.length}` : '无');

// ---------- 5. 下一次炼金能读取上一轮行动结果 ----------
const alchemyPayload = lib.buildAlchemyPayload({
  mode: 'live',
  topic: '数据分析实习还有机会吗',
  persona: { city: '上海' },
  queries: ['数据分析 实习'],
  records: lib.loadRecords(),
});
check('炼金请求体带上「上一轮行动结果」',
  alchemyPayload.records.length > 0
  && alchemyPayload.records[0].actionFeedback
  && alchemyPayload.records[0].actionFeedback.down.length === 1
  && alchemyPayload.records[0].actionFeedback.notes.length === 1,
  `records=${alchemyPayload.records.length}`);
const selected = zhihu.selectHistory('数据分析实习还有机会吗', alchemyPayload.records);
check('后端能选出相关历史（历史确实进入炼金上下文，不是摆设）',
  Array.isArray(selected) && selected.length >= 1,
  `命中 ${selected.length} 条`);

// ---------- 6. 历史记录能显示路线变化 ----------
const prevRec = {
  topic: '要不要转数据分析',
  ts: Date.now() - 86400000,
  quiz: { dominant: ['r1'] },
  data: { conflict: { roles: [{ id: 'r1', name: '实干派' }] } },
  actionFeedback: { done: 2, up: ['x'], down: [], unclear: [], notes: [] },
};
const change = lib.diffRouteChange(prevRec, { dominant: ['r2'] }, [{ id: 'r2', name: '谋略派' }]);
check('判断变了：能算出入上次信哪派、这次信哪派',
  change && change.changed === true && change.prevName === '实干派' && change.curName === '谋略派',
  change ? `${change.prevName} → ${change.curName}` : '');
const same = lib.diffRouteChange(prevRec, { dominant: ['r1'] }, [{ id: 'r1', name: '实干派' }]);
check('判断没变：也能显示「仍是最信那一派」', same && same.changed === false && same.curName === '实干派');
check('历史条目能带上上一轮行动结果（历史页显示"上次做了什么/结果如何"）',
  change && change.feedback && change.feedback.done === 2);

// ---------- 附加：观点墙 → 自测 的绑定 ----------
const q = { options: [{ label: 'a', side: 'r2' }, { label: 'b', side: 'r2' }, { label: 'c', side: 'r1' }] };
check('题目能推导出主要对应的观点角色（不是通用问卷）',
  lib.quizFocusRole(q, [{ id: 'r1' }, { id: 'r2' }]) === 'r2');
check('后端给了 focusRole 时以后端为准',
  lib.quizFocusRole({ focusRole: 'r3', options: [] }, [{ id: 'r1' }]) === 'r3');

localStorage.setItem('other-app:key', 'keep');
localStorage.setItem('alchemy:actions:test', '{}');
localStorage.setItem('alchemy:road:test', '{}');
check('清空本地记录只删除 alchemy 数据，不碰同域其他产品',
  lib.clearLocalData() === true && localStorage.getItem('other-app:key') === 'keep'
  && localStorage.getItem('alchemy:records') === null && localStorage.getItem('alchemy:actions:test') === null
  && localStorage.getItem('alchemy:road:test') === null);

const failed = results.filter((r) => !r.ok);
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('；'));
  process.exit(1);
}
console.log('界面联动回归：全部通过');
