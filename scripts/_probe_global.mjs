// 临时探针：打印 global_search 真实返回结构，校准字段映射后删除
import { readFileSync } from 'node:fs';
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
const SECRET = process.env.OPENAI_API_KEY || process.env.ZHIHU_ACCESS_SECRET || '';
console.log('SECRET present:', Boolean(SECRET && SECRET.trim()));
const url = new URL('https://developer.zhihu.com/api/v1/content/global_search');
url.searchParams.set('Query', 'AI 求职');
url.searchParams.set('Count', '3');
try {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${SECRET}`, 'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const txt = await r.text();
  console.log('STATUS', r.status);
  console.log(txt.slice(0, 2500));
} catch (e) {
  console.error('ERR', e?.name || e?.message || e);
}
