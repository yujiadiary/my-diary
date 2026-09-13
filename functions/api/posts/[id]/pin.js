// POST /api/posts/:id/pin   切换置顶(需登录)
import { json, handleCors, requireAuth } from '../../../_lib/util.js';
const now = () => new Date().toISOString();

export async function onRequestPost({ request, params, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  const row = await env.DB.prepare('SELECT pinned FROM posts WHERE id = ?').bind(params.id).first();
  if (!row) return json({ error: '文章不存在' }, 404);
  await env.DB.prepare('UPDATE posts SET pinned = ?, updated_at = ? WHERE id = ?')
    .bind(row.pinned ? 0 : 1, now(), params.id).run();
  return json({ pinned: !row.pinned });
}
export async function onRequestOptions() { return handleCors(true); }
