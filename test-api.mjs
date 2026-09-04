import { personaPayload, buildQueries } from './src/lib.js';

const card = {
  stage: 'explore',
  goals: ['intern'],
  industry: 'it',
  sub: '前端',
  city: '上海',
  timePressure: '3个月内',
  confusion: '前端秋招到底卷不卷，我这种背景有没有机会',
  education: '某211本科计算机，两段实习',
  customIndustry: '',
};

const body = {
  mode: 'LIVE',
  topic: card.confusion,
  persona: personaPayload(card),
  queries: buildQueries(card),
};

console.log('payload persona:', body.persona.prompt);
console.log('payload queries:', body.queries);

try {
  const res = await fetch('http://127.0.0.1:3000/api/alchemy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log('status:', res.status);
  console.log('response:', text.slice(0, 800));
} catch (e) {
  console.error('fetch error:', e.message);
}
