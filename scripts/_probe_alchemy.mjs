// 临时探针：真实密钥跑一次 alchemy，确认全网来源进入返回；走查后删除
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zhihu from '../zhihu.js';
// 清理可能被 mock 回归脚本污染的 .cache，保证真实走查读到真实接口数据
rmSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.cache'), { recursive: true, force: true });
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
const SECRET = process.env.OPENAI_API_KEY || process.env.ZHIHU_ACCESS_SECRET || '';
const persona = { identityName: '准入行', industryName: 'AI', subName: 'AIGC', goalNames: ['求职'], city: '北京', timePressure: '三个月', confusion: '怎么选' };
const out = await zhihu.alchemy(SECRET, '数据分析师 求职', persona, ['数据分析师 求职', '商科转数据分析']);
console.log('fallback:', out.fallback, '| mock:', out.mock, '| roles:', (out.conflict?.roles || []).length);
console.log('sources:', JSON.stringify((out.sources || []).map((s) => ({ source: s.source || 'zhihu', title: (s.title || '').slice(0, 28) })), null, 0));
const roles = out.conflict?.roles || [];
const webInRoles = roles.some((r) => (r.sourceItems || []).some((it) => it.source === 'web'));
console.log('anyRoleHasWebSource:', webInRoles);
