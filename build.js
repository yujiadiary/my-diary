// 构建脚本:扫描 posts/*.md,解析 frontmatter,生成 posts/index.json
// 在 Cloudflare Pages 部署时自动执行(build command = node build.js)
// 前台只 fetch /posts/index.json 一次,就能渲染所有列表/详情/搜索页
//
// frontmatter 支持字段:title author category tags createdAt updatedAt
//                     pinned hidden draft images
// author/category 用 id(yu/jiang/zhou/archive;daily/long/photo/code/music/backup)
// tags 既可以是 [a, b] 也可以是 "a, b"
// images 既可以是 [url1, url2] 也可以是每行一个 url 的字符串

const fs = require('fs');
const path = require('path');

const POSTS_DIR = path.join(__dirname, 'posts');
const OUT_FILE = path.join(POSTS_DIR, 'index.json');

function parseFrontmatter(text) {
  // 解析 --- 包裹的 YAML 头,极简实现,不引依赖
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text.trim() };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const idx = line.indexOf(':');
    if (idx < 0) { i++; continue; }
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // 多行数组开头 [a, b] 单行
    if (val.startsWith('[')) {
      // 找到闭合 ]
      while (!val.includes(']') && i + 1 < lines.length) { i++; val += ' ' + lines[i]; }
      const inner = val.replace(/^\[/, '').replace(/\]$/, '').trim();
      if (inner) {
        data[key] = inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        data[key] = [];
      }
    } else if (val === '') {
      // 多行数组(每行 - xxx)
      const arr = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        i++;
        arr.push(lines[i].replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
      }
      data[key] = arr.length ? arr : '';
    } else {
      data[key] = val.replace(/^["']|["']$/g, '');
    }
    i++;
  }
  return { data, body: m[2].trim() };
}

function toBool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  return /^(true|yes|on|1)$/i.test(String(v));
}

function toList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return String(v).split(/[,，]/).map(s => s.trim()).filter(Boolean);
}

function excerpt(body, n) {
  if (!body) return '';
  const t = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*`>\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function build() {
  if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
  }
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  const posts = files.map(file => {
    const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const slug = file.replace(/\.md$/, '');
    const fm = data || {};
    return {
      slug,
      title: fm.title || slug,
      author: fm.author || 'yu',
      category: fm.category || 'daily',
      tags: toList(fm.tags),
      images: toList(fm.images),
      pinned: toBool(fm.pinned, false),
      hidden: toBool(fm.hidden, false),
      draft: toBool(fm.draft, false),
      createdAt: fm.createdAt || null,
      updatedAt: fm.updatedAt || null,
      excerpt: excerpt(body, 160),
      content: body
    };
  });
  // 按 createdAt 降序(无日期的排到后面)
  posts.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1; // 置顶优先(同级再用时间排)
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  const out = { generatedAt: new Date().toISOString(), count: posts.length, posts };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
  console.log(`[build] 生成 posts/index.json · ${posts.length} 篇`);
}

build();
