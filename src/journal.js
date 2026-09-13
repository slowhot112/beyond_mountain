import { loadRoad, normalizeCurrentTask, replaceInternalRoleIds, viewpointAngle } from './lib.js';

export const JOURNAL_FILTERS = [
  { id: 'all', label: '全部判断' },
  { id: 'waiting', label: '等我确认' },
  { id: 'verifying', label: '正在验证' },
  { id: 'confirmed', label: '已经确认' },
];

export function judgmentStatus(state = {}) {
  const choice = state.memoryDecision?.choice;
  if (choice === 'keep') return 'kept';
  if (choice === 'revise') return 'revised';
  if (choice === 'release') return 'released';
  if (choice === 'defer') return 'verifying';
  const hasRealityFact = String(state.note || '').trim().length >= 4;
  if ((state.verdict || state.stage === 'pending_confirmation') && hasRealityFact) return 'waiting';
  return 'verifying';
}

export function judgmentStatusLabel(status) {
  return ({ waiting: '等待确认变化', verifying: '正在验证', kept: '已保留', revised: '已修正', released: '已放下' })[status] || '正在验证';
}

export function collectJournalJudgments(records = []) {
  const out = [];
  records.forEach((record) => {
    if (!record?.data) return;
    const road = loadRoad(record.data);
    const roles = record.data?.conflict?.roles || [];
    const current = normalizeCurrentTask({ ...(record.currentTask || {}), ...(road.__current || {}) });
    if (current && (current.started || current.verdict || current.memoryDecision)) {
      const roleIndex = roles.findIndex((role) => role.id === current.roleId);
      const state = current;
      out.push({
        id: `${record.id}:__current`, record, roadKey: '__current', state,
        title: replaceInternalRoleIds(current.verify || '这条判断是否适合我的处境', roles),
        angle: current.angle || viewpointAngle(roles[roleIndex], roleIndex),
        formedAt: record.ts, updatedAt: state.memoryDecision?.confirmedAt || state.completedAt || record.ts,
        status: judgmentStatus(state), origin: '从观点墙选定',
      });
    }

    (record.data?.roadmap?.phases || []).forEach((phase, phaseIndex) => {
      (phase.tasks || []).forEach((task, taskIndex) => {
        const roadKey = `p${phaseIndex}t${taskIndex}`;
        const state = road[roadKey] || {};
        if (!state.done && !state.note && !state.verdict && !state.memoryDecision) return;
        const roleIndex = roles.findIndex((role) => role.id === task.role);
        out.push({
          id: `${record.id}:${roadKey}`, record, roadKey, state,
          title: replaceInternalRoleIds(task.hypothesis || task.done || phase.title || '行动路线中的判断', roles),
          angle: task.role ? viewpointAngle(roles[roleIndex], roleIndex) : '看现实结果',
          formedAt: record.ts, updatedAt: state.memoryDecision?.confirmedAt || state.completedAt || record.ts,
          status: judgmentStatus(state), origin: phase.title || '行动路线', task,
        });
      });
    });
  });
  const rank = { waiting: 0, verifying: 1, revised: 2, kept: 2, released: 3 };
  return out.sort((a, b) => (rank[a.status] - rank[b.status]) || (Number(b.updatedAt) - Number(a.updatedAt)));
}

function artifactName(text = '') {
  const quoted = String(text).match(/《([^》]+)》/);
  if (quoted) return quoted[1];
  const raw = String(text).split(/[：:（(]/)[0].replace(/^\s*[✅📦]?\s*/, '').trim();
  return raw.length > 28 ? `${raw.slice(0, 28)}…` : (raw || '未命名成果');
}

export function artifactType(text = '') {
  const s = String(text);
  if (/能力差距/.test(s)) return '能力差距清单';
  if (/岗位地图|\bJD\b|岗位清单|职位清单/i.test(s)) return '岗位地图';
  if (/调研|访谈|竞品|试用|试读|用户原话/.test(s)) return '调研与试用记录';
  if (/评测|测试/.test(s)) return '评测记录';
  if (/简历/.test(s)) return '简历';
  if (/投递|漏斗/.test(s)) return '投递记录';
  if (/面试|题库|录音/.test(s)) return '面试准备';
  if (/SQL|手册|学习|练习|自测/i.test(s)) return '能力证明';
  if (/作品|项目|优化前后/.test(s)) return '作品';
  return artifactName(s);
}

export function collectJournalArtifacts(records = []) {
  const out = [];
  records.forEach((record) => {
    const roadmap = record?.data?.roadmap;
    if (!record?.data || !roadmap?.graduation?.checklist) return;
    const road = loadRoad(record.data);
    const current = normalizeCurrentTask({ ...(record.currentTask || {}), ...(road.__current || {}) });
    roadmap.graduation.checklist.forEach((item, index) => {
      const key = `g${index}`;
      const state = road[key] || {};
      out.push({
        id: `${record.id}:${key}`, record, roadKey: key, state,
        name: artifactName(item.text), type: artifactType(item.text), text: item.text,
        verify: item.verify || '', done: Boolean(state.done),
        judgment: replaceInternalRoleIds(current?.verify || roadmap.goal?.text || record.topic, record.data?.conflict?.roles || []),
        updatedAt: state.updatedAt || record.ts,
      });
    });
  });
  return out.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
}

export function journalSummary(records = []) {
  const judgments = collectJournalJudgments(records);
  return {
    total: judgments.length,
    waiting: judgments.filter((item) => item.status === 'waiting').length,
    verifying: judgments.filter((item) => item.status === 'verifying').length,
    confirmed: judgments.filter((item) => ['kept', 'revised'].includes(item.status)).length,
  };
}

export function findCarryoverCandidates(records = [], card = {}) {
  const latestByRecord = new Map();
  collectJournalJudgments(records)
    .filter((item) => ['kept', 'revised'].includes(item.status))
    .forEach((item) => { if (!latestByRecord.has(item.record.id)) latestByRecord.set(item.record.id, item); });
  const fields = [
    ['city', '目标城市'], ['stage', '求职阶段'], ['goal', '求职目标'],
    ['industry', '目标行业'], ['subIndustry', '具体方向'],
  ];
  return [...latestByRecord.values()].map((item) => {
    const previous = item.record.card || {};
    const matches = [];
    const differences = [];
    fields.forEach(([key, label]) => {
      const now = String(card?.[key] || '').trim();
      const before = String(previous?.[key] || '').trim();
      if (!now || !before) return;
      if (now === before) matches.push(label);
      else differences.push(label);
    });
    return { ...item, matches, differences, score: matches.length * 2 - differences.length };
  }).filter((item) => item.matches.length > 0).sort((a, b) => b.score - a.score || Number(b.updatedAt) - Number(a.updatedAt)).slice(0, 3);
}
