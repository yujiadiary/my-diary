// DELETE /api/posts/:id/permanent   彻底删除(需登录)
import { json, handleCors, requireAuth } from '../../../_lib/util.js';

export async function onRequestDelete({ request, params, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
export async function onRequestOptions() { return handleCors(true); }
