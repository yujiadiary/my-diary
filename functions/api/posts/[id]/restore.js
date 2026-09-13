// POST /api/posts/:id/restore   从回收站恢复(需登录)
import { json, handleCors, requireAuth } from '../../../_lib/util.js';
const now = () => new Date().toISOString();

export async function onRequestPost({ request, params, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  await env.DB.prepare('UPDATE posts SET deleted_at = NULL, updated_at = ? WHERE id = ?')
    .bind(now(), params.id).run();
  return json({ ok: true });
}
export async function onRequestOptions() { return handleCors(true); }
