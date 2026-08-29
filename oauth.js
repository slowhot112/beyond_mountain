// OAuth 接入框架（知乎黑客松联调基线）
// 文档依据：zhihu-hackathon/references/oauth-boundary.md
// 说明：
//  - 真实 OAuth 需要 app_id + app_key + 公网 HTTPS 回调（localhost 跑不通）
//  - 本模块同时支持 MOCK 模式（OAUTH_MOCK=true），本地可直接演示"授权→分析"流程
//  - 认证请求头：X-OAuth-App-Key + X-Oauth-Nonce + X-Oauth-Timestamp + X-Oauth-Signature
//  - 资源请求头：X-OAuth-Token（由授权换得）

import crypto from 'node:crypto';

const OAUTH_BASE = 'https://oauth.zhihu.com';
const APP_ID = process.env.ZHIHU_OAUTH_APP_ID || '';
const APP_KEY = process.env.ZHIHU_OAUTH_APP_KEY || '';
const REDIRECT_URI = process.env.ZHIHU_OAUTH_REDIRECT || 'http://localhost:3000/api/oauth/callback';
const MOCK = (process.env.OAUTH_MOCK || 'true') === 'true'; // 默认本地 mock

// 生成签名（参考文档 HMAC-SHA256）
function oauthSignature(appKey, ts, nonce) {
  return crypto.createHmac('sha256', appKey).update(`${ts}${nonce}`).digest('hex');
}

function authHeaders() {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(8).toString('hex');
  return {
    'X-OAuth-App-Key': APP_ID,
    'X-Oauth-Nonce': nonce,
    'X-Oauth-Timestamp': ts,
    'X-Oauth-Signature': oauthSignature(APP_KEY, ts, nonce),
  };
}

// 生成授权跳转 URL（用户扫码/确认）
export function getAuthorizeUrl(state = 'alchemy') {
  const u = new URL(`${OAUTH_BASE}/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('app_id', APP_ID);
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('state', state);
  return u.toString();
}

// 用 code 换 access_token
export async function exchangeToken(code) {
  if (MOCK) {
    // 本地演示：不真实请求知乎，返回一个假 token
    return { access_token: 'mock_token_' + crypto.randomBytes(6).toString('hex'), mock: true };
  }
  const r = await fetch(`${OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
  });
  if (!r.ok) throw new Error('token exchange failed: ' + r.status);
  return r.json();
}

// 用 token 拉当前授权用户的基础信息（接口仅实测提示，无正式 schema）
export async function getUserInfo(token) {
  if (MOCK) {
    return {
      mock: true,
      name: '知乎示例用户',
      // 真实接入后这里会返回关注/粉丝等字段；当前按文档"实测提示"预留
      note: 'MOCK 模式：部署到公网并配置真实 app_id/app_key 后，此处返回你的关注/粉丝信息，用于生成"信息宇宙"分析。',
    };
  }
  const r = await fetch(`${OAUTH_BASE}/user`, {
    method: 'GET',
    headers: { 'X-OAuth-Token': token, ...authHeaders() },
  });
  if (!r.ok) throw new Error('get user failed: ' + r.status);
  return r.json();
}

export const oauthConfig = { MOCK, REDIRECT_URI, hasAppCreds: !!(APP_ID && APP_KEY) };
