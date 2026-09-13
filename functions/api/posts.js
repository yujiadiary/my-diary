// /api/posts
// GET:    列表(前台用,可选 query: author/category/tag/q/page/pageSize/listMode=all|drafts|trash)
// POST:   创建(需登录)
import { json, handleCors, rowToPost, postToRow, newId, requireAuth } from '../_lib/util.js';

const now = () => new Date().toISOString();

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const listMode = params.get('listMode') || 'public'; // public | all | drafts | trash
  const page = parseInt(params.get('page') || '1', 10) || 1;
  const pageSize = parseInt(params.get('pageSize') || String(env.PAGE_SIZE || '20'), 10) || 20;
  const author = params.get('author') || '';
  const category = params.get('category') || '';
  const tag = params.get('tag') || '';
  const q = (params.get('q') || '').toLowerCase();

  let sql, binds;
  if (listMode === 'trash') {
    sql = 'SELECT * FROM posts WHERE deleted_at IS NOT NULL';
    binds = [];
  } else if (listMode === 'drafts') {
    sql = 'SELECT * FROM posts WHERE draft = 1 AND deleted_at IS NULL';
    binds = [];
  } else if (listMode === 'all') {
    sql = 'SELECT * FROM posts WHERE deleted_at IS NULL';
    binds = [];
  } else {
    sql = 'SELECT * FROM posts WHERE draft = 0 AND hidden = 0 AND deleted_at IS NULL';
    binds = [];
  }

  const where = [];
  if (author) { where.push('author = ?'); binds.push(author); }
  if (category) { where.push('category = ?'); binds.push(category); }
  if (tag) { where.push("tags LIKE ?"); binds.push(`%"${tag.replace(/"/g, '')}"%`); }
  if (q) {
    where.push("(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ' AND ' + where.join(' AND ');

  // 排序:置顶优先,然后按创建时间倒序
  sql += ' ORDER BY pinned DESC, created_at DESC';

  // 总数
  const countSql = 'SELECT COUNT(*) as c FROM (' + sql + ')';
  const countRow = (await env.DB.prepare(countSql).bind(...binds).first()) || { c: 0 };
  const total = countRow.c;

  // 分页
  sql += ' LIMIT ? OFFSET ?';
  binds.push(pageSize, (page - 1) * pageSize);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();

  return json({
    list: (results || []).map(rowToPost),
    page,
    pageSize,
    total
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  let body;
  try { body = await request.json(); } catch (e) { body = {}; }

  const ts = now();
  const post = {
    id: body.id || newId(),
    title: (body.title || '').trim(),
    content: body.content || '',
    author: body.author || '',
    category: body.category || '',
    tags: Array.isArray(body.tags) ? body.tags : parseTags(body.tags),
    images: Array.isArray(body.images) ? body.images : [],
    pinned: !!body.pinned,
    hidden: !!body.hidden,
    draft: !!body.draft,
    deletedAt: null,
    createdAt: body.createdAt || ts,
    updatedAt: ts
  };

  const row = postToRow(post);
  await env.DB.prepare(
    `INSERT INTO posts (id, title, content, author, category, tags, images, pinned, hidden, draft, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.id, row.title, row.content, row.author, row.category, row.tags, row.images,
    row.pinned, row.hidden, row.draft, row.deleted_at, row.created_at, row.updated_at
  ).run();

  return json({ post }, 201);
}

export async function onRequestOptions() { return handleCors(true); }

function parseTags(input) {
  if (!input) return [];
  return String(input).split(/[,，]/).map(t => t.trim()).filter(Boolean);
}
