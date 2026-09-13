// POST /api/posts/seed   生成种子数据
// 规则:数据库为空时任何人都能调(引导首次内容);有数据则需登录
import { json, handleCors, postToRow, newId, requireAuth } from '../../_lib/util.js';
const now = () => new Date().toISOString();

export async function onRequestPost({ request, env }) {
  const count = await env.DB.prepare('SELECT COUNT(*) as c FROM posts').first();
  const hasData = count && count.c > 0;

  // 表里有数据了,需要登录才能再触发(防止匿名重置/干扰)
  if (hasData) {
    const auth = await requireAuth(request, env);
    if (!auth.ok) return auth.response;
    return json({ ok: true, message: '已有数据,不重复初始化', count: count.c });
  }

  const samples = [
    {
      id: newId(), title: '欢迎来到碎碎念留档',
      content: '这里是一个私人的多作者记录站。\n\n你可以在这里写下日常、长文、图片、代码、歌单,也可以把要存档的东西备份进来。\n\n后台路径是 #/admin,密码在 Cloudflare 环境变量 ADMIN_PASSWORD 里。',
      author: 'archive', category: 'long', tags: ['说明', '开始'], images: [],
      pinned: true, hidden: false, draft: false
    },
    {
      id: newId(), title: '今天的天气',
      content: '阴天,有点风。\n\n> 安静的时候最适合写点什么。',
      author: 'yu', category: 'daily', tags: ['日常'], images: [],
      pinned: false, hidden: false, draft: false
    }
  ];
  const ts = now();
  for (const p of samples) {
    p.deletedAt = null; p.createdAt = ts; p.updatedAt = ts;
    const row = postToRow(p);
    await env.DB.prepare(
      `INSERT INTO posts (id, title, content, author, category, tags, images, pinned, hidden, draft, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      row.id, row.title, row.content, row.author, row.category, row.tags, row.images,
      row.pinned, row.hidden, row.draft, row.deleted_at, row.created_at, row.updated_at
    ).run();
  }
  return json({ ok: true, inserted: samples.length });
}
export async function onRequestOptions() { return handleCors(true); }
