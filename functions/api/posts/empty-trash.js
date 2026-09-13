// POST /api/posts/empty-trash   清空回收站(需登录)
import { json, handleCors, requireAuth } from '../../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  await env.DB.prepare('DELETE FROM posts WHERE deleted_at IS NOT NULL').run();
  return json({ ok: true });
}
export async function onRequestOptions() { return handleCors(true); }
