// GET /api/export  导出全部数据(需登录)
import { json, handleCors, requireAuth, rowToPost } from '../_lib/util.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  const { results } = await env.DB.prepare('SELECT * FROM posts').all();
  return json({
    version: 2,
    exportedAt: new Date().toISOString(),
    posts: (results || []).map(rowToPost)
  });
}
export async function onRequestOptions() { return handleCors(true); }
