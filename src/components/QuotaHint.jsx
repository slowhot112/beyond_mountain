// 工单05：剩余额度常态化提示
// 数据通路：复用 App.jsx 现有的 /api/health 获取结果（health state 经 props 传入），
// 本组件自身不发起任何请求、不新增轮询。health 数据来自后端免费额度查询
// （zhihu /api/v1/quota，health 已复用它，不消耗直答 100 次/天配额）。
// 响应 schema 以 docs/ZHIHU-API.md（v1.2 已验证）与知乎开放平台 HTTP 文档为准：
//   raw = { Code, Message, Data: [{ APIID, APIName, TotalQuota, TotalUsed, RemainingQuota }] }
// 防御性规则（对应已知服务端缺陷：health 不校验业务码，假 Secret 也 reachable:true）：
//   Code !== 0（如 20001 鉴权失败）→ 整体不渲染；
//   Data 中无任何可识别额度字段 → 防御性展示「已连通（额度详情不可用）」，绝不编造数字。

// 直答剩余低于该值 → 追加醒目预警（纯提示，不拦截任何按钮/流程）
export const LOW_QUOTA_THRESHOLD = 20;

// 直答 Agent（POST /v1/chat/completions，100 次/天上限）是主指标
const PRIMARY_APIID = 'zhida_openai';

// 开放平台公开 APIID → 展示名（Data[].APIName 缺失时的兜底）
const APIID_LABELS = {
  zhida_openai: '知乎直答',
  hot_list: '热榜',
  zhihu_search: '知乎搜索',
  global_search: '全网搜索',
  user_data: '用户数据',
  knowledge: '知识库',
  tools: '小工具',
};

// 只接受真实的数字/整数字符串，其余一律视为「没有这个字段」
function toInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return null;
}

// 解析 raw（知乎额度接口原样响应）→ { kind:'ok', items } | { kind:'opaque' } | { kind:'fail' }
function parseQuota(raw) {
  if (raw == null || typeof raw === 'string' || typeof raw !== 'object') return { kind: 'opaque' };
  // 业务码失败（20001 鉴权失败 / 30001 限频 / 90001 请求失败）→ 额度查询失败，整体隐藏
  if (Number.isFinite(raw.Code) && raw.Code !== 0) return { kind: 'fail' };
  const list = Array.isArray(raw.Data) ? raw.Data : [];
  const items = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const remaining = toInt(it.RemainingQuota);
    const total = toInt(it.TotalQuota);
    if (remaining == null && total == null) continue; // 无可识别额度数字 → 跳过，绝不编造
    const apiId = typeof it.APIID === 'string' ? it.APIID : '';
    items.push({
      apiId,
      name: (typeof it.APIName === 'string' && it.APIName.trim()) || APIID_LABELS[apiId] || apiId || '额度项',
      remaining,
      total,
    });
  }
  if (!items.length) return { kind: 'opaque' };
  return { kind: 'ok', items };
}

export default function QuotaHint({ health }) {
  // 无数据 / 请求失败 / NO_SECRET / PROBE_FAILED → 整体不渲染
  if (!health || health.ok !== true) return null;
  if (health.reachable === false) return null; // 防御：服务端明确不可达
  // App.jsx setHealth({...data}) 把 data 平铺到顶层，raw 同时兼容顶层与 data 内嵌两种形态
  const raw = health.raw != null ? health.raw : health.data?.raw;
  const parsed = parseQuota(raw);
  if (parsed.kind === 'fail') return null; // 额度查询业务失败 → 整体隐藏
  if (parsed.kind === 'opaque') {
    // LIVE 但解析不出额度字段：诚实降级，不显示任何数字
    return <span className="quota-hint quota-opaque">✓ 知乎接口已连通（额度详情不可用）</span>;
  }

  const primary = parsed.items.find((x) => x.apiId === PRIMARY_APIID) || null;
  const others = parsed.items.filter((x) => x.apiId !== PRIMARY_APIID);
  const low = primary != null && primary.remaining != null && primary.remaining < LOW_QUOTA_THRESHOLD;

  return (
    <span className={`quota-hint${low ? ' quota-low' : ''}`} role="status">
      {primary && (
        <span className="quota-item quota-primary">
          直答剩余 <b>{primary.remaining ?? '—'}</b>
          {primary.total != null ? <>/{primary.total}</> : null}
        </span>
      )}
      {others.map((x) => (
        <span key={x.apiId || x.name} className="quota-item quota-other">
          {x.name} {x.remaining ?? '—'}{x.total != null ? `/${x.total}` : ''}
        </span>
      ))}
      {low && <span className="quota-warn">⚠ 演示额度紧张，将自动回落演示数据</span>}
    </span>
  );
}
