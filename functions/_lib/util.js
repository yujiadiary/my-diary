// 共享工具:鉴权、CORS、JSON 响应、行 ↔ 对象映射
// 放在 functions/_lib/ 下,Cloudflare Pages 不会把 _ 开头的当作路由

// ---------- JSON 响应 ----------
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      ...extraHeaders
    }
  });
}

// ---------- CORS 预检 ----------
export function handleCors(preflight) {
  return new Response(null, {
    status: preflight ? 204 : 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400'
    }
  });
}

// ---------- DB 行 ↔ 前端对象 ----------
export function rowToPost(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    author: row.author,
    category: row.category,
    tags: safeParse(row.tags, []),
    images: safeParse(row.images, []),
    pinned: !!row.pinned,
    hidden: !!row.hidden,
    draft: !!row.draft,
    deletedAt: row.deleted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

export function postToRow(p) {
  return {
    id: p.id,
    title: p.title || '',
    content: p.content || '',
    author: p.author || '',
    category: p.category || '',
    tags: JSON.stringify(Array.isArray(p.tags) ? p.tags : []),
    images: JSON.stringify(Array.isArray(p.images) ? p.images : []),
    pinned: p.pinned ? 1 : 0,
    hidden: p.hidden ? 1 : 0,
    draft: p.draft ? 1 : 0,
    deleted_at: p.deletedAt || null,
    created_at: p.createdAt,
    updated_at: p.updatedAt
  };
}

// ---------- 鉴权 ----------
// 简单方案:登录验证密码 → 返回 HMAC 签名的 token(payload:admin,exp)
// 后续请求带 Authorization: Bearer <token>,中间件验签
// 不用第三方库,用 Web Crypto API

export async function signToken(env, payload = { role: 'admin' }, ttlSec = 7 * 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = { ...payload, exp };
  const bodyB64 = btoa(JSON.stringify(body));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_SECRET || 'dev-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyB64));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${bodyB64}.${sigB64}`;
}

export async function verifyToken(env, token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [bodyB64, sigB64] = parts;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_SECRET || 'dev-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  let ok = false;
  try {
    const sigBin = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
    ok = await crypto.subtle.verify('HMAC', key, sigBin, new TextEncoder().encode(bodyB64));
  } catch (e) { return null; }
  if (!ok) return null;
  try {
    const body = JSON.parse(atob(bodyB64));
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch (e) { return null; }
}

// 从请求里取 token
export function getToken(request) {
  const h = request.headers.get('Authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

// 要求登录,失败返回 401
export async function requireAuth(request, env) {
  const payload = await verifyToken(env, getToken(request));
  if (!payload) return { ok: false, response: json({ error: '未登录或登录已过期' }, 401) };
  return { ok: true, payload };
}

// 生成新 id
export function newId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
