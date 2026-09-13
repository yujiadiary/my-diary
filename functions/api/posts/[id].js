// /api/posts/:id
// GET:    详情
// PUT:    更新(需登录)
// DELETE: 软删除(移入回收站,需登录)
import { json, handleCors, rowToPost, requireAuth } from '../../_lib/util.js';

const now = () => new Date().toISOString();

export async function onRequestGet({ params, env }) {
  const row = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(params.id).first();
  if (!row) return json({ error: '文章不存在' }, 404);
  return json({ post: rowToPost(row) });
}

export async function onRequestPut({ request, params, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const existing = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(params.id).first();
  if (!existing) return json({ error: '文章不存在' }, 404);

  let body;
  try { body = await request.json(); } catch (e) { body = {}; }

  const tags = Array.isArray(body.tags) ? body.tags
    : (body.tags ? String(body.tags).split(/[,，]/).map(t => t.trim()).filter(Boolean) : JSON.parse(existing.tags || '[]'));
  const images = Array.isArray(body.images) ? body.images : JSON.parse(existing.images || '[]');

  await env.DB.prepare(
    `UPDATE posts SET
       title = ?, content = ?, author = ?, category = ?,
       tags = ?, images = ?, pinned = ?, hidden = ?, draft = ?,
       updated_at = ?
     WHERE id = ?`
  ).bind(
    (body.title ?? existing.title).toString().trim(),
    body.content ?? existing.content,
    body.author ?? existing.author,
    body.category ?? existing.category,
    JSON.stringify(tags),
    JSON.stringify(images),
    body.pinned ? 1 : 0,
    body.hidden ? 1 : 0,
    body.draft ? 1 : 0,
    now(),
    params.id
  ).run();

  const updated = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(params.id).first();
  return json({ post: rowToPost(updated) });
}

export async function onRequestDelete({ request, params, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  // 软删除 -> 回收站
  await env.DB.prepare(
    'UPDATE posts SET deleted_at = ?, pinned = 0, updated_at = ? WHERE id = ?'
  ).bind(now(), now(), params.id).run();
  return json({ ok: true });
}

export async function onRequestOptions() { return handleCors(true); }
