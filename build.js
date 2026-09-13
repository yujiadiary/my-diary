// 构建脚本:扫描 posts/*.md,生成:
//   1. posts/index.json      —— 前台 SPA fetch 用(列表/筛选/搜索)
//   2. posts/<slug>.html     —— 每篇文章的纯静态页(SSG,正文在 HTML 源码里可见,供爬虫抓取)
//   3. sitemap.xml           —— 站点地图,列出所有公开文章 URL
// 在 GitHub Actions 部署时自动执行(详见 .github/workflows/build.yml)
//
// frontmatter 支持字段:title author category tags createdAt updatedAt
//                     pinned hidden draft images
// author/category 用 id(yu/jiang/zhou/archive;daily/long/photo/code/music/backup)
// tags 既可以是 [a, b] 也可以是 "a, b"
// images 既可以是 [url1, url2] 也可以是每行一个 url 的字符串

const fs = require('fs');
const path = require('path');

const POSTS_DIR = path.join(__dirname, 'posts');
const OUT_INDEX = path.join(POSTS_DIR, 'index.json');
const SITEMAP = path.join(__dirname, 'sitemap.xml');

// 站点根 URL(sitemap.xml 必须用绝对地址)
// GitHub Pages 默认:https://<user>.github.io/<repo>/
// 用自定义域名时改这一行,或设环境变量 SITE_URL
const SITE_URL = (process.env.SITE_URL || 'https://yujiadiary.github.io/my-diary/').replace(/\/+$/, '') + '/';

// 作者/分类元数据(与 assets/js/config.js 保持同步;改这里记得也改 config.js)
const AUTHORS = [
  { id: 'yu',      name: '于加',     desc: '于加的碎碎念与记录。' },
  { id: 'jiang',    name: '江予朔',   desc: '江予朔写下的内容。' },
  { id: 'zhou',    name: '周叙',     desc: '周叙的部分。' },
  { id: 'archive', name: '共同存档', desc: '我们一起保存下来的东西。' }
];
const CATEGORIES = [
  { id: 'daily',  name: '日常碎碎念' },
  { id: 'long',   name: '长文/正式记录' },
  { id: 'photo',  name: '图片/相册' },
  { id: 'code',   name: '代码/创作' },
  { id: 'music',  name: '音乐/歌单' },
  { id: 'backup', name: '存档/备份' }
];

function authorName(id) { return (AUTHORS.find(a => a.id === id) || {}).name || id; }
function categoryName(id) { return (CATEGORIES.find(c => c.id === id) || {}).name || id; }

// ---------- frontmatter 解析(极简实现,不引依赖) ----------
function parseFrontmatter(text) {
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
    if (val.startsWith('[')) {
      while (!val.includes(']') && i + 1 < lines.length) { i++; val += ' ' + lines[i]; }
      const inner = val.replace(/^\[/, '').replace(/\]$/, '').trim();
      data[key] = inner
        ? inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        : [];
    } else if (val === '') {
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

// ---------- HTML 转义 ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Markdown 渲染(SSG 版,行为与 assets/js/markdown.js 一致,但不折叠,全文输出) ----------
function renderLine(line) {
  const trimmed = line.trim();
  if (/^https?:\/\/\S+\.(png|jpg|jpeg|gif|webp|svg)(\?\S*)?$/i.test(trimmed)) {
    return `<div class="md-image"><img src="${escapeHtml(trimmed)}" alt="" loading="lazy"></div>`;
  }
  if (/^https?:\/\/\S+$/.test(trimmed)) {
    return `<p><a href="${escapeHtml(trimmed)}" target="_blank" rel="noopener noreferrer">${escapeHtml(trimmed)}</a></p>`;
  }
  if (line.startsWith('> ')) {
    const text = line.replace(/^>\s?/, '');
    return `<blockquote>${escapeHtml(text)}</blockquote>`;
  }
  if (trimmed === '') return '';
  let html = escapeHtml(line);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return `<p>${html}</p>`;
}

function renderMarkdown(text) {
  if (!text) return '';
  const segments = [];
  const codeBlockRe = /```(\w*)\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let m;
  while ((m = codeBlockRe.exec(text)) !== null) {
    if (m.index > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, m.index) });
    segments.push({ type: 'code', lang: m[1] || '', value: m[2] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) });

  let html = '';
  segments.forEach(seg => {
    if (seg.type === 'code') {
      const langAttr = seg.lang ? ` data-lang="${escapeHtml(seg.lang)}"` : '';
      html += `<pre class="md-code"${langAttr}><code>${escapeHtml(seg.value.replace(/\r?\n$/, ''))}</code></pre>`;
    } else {
      const lines = seg.value.split(/\r?\n/);
      let buf = [];
      lines.forEach(line => {
        const isQuote = line.startsWith('> ') || line.startsWith('>\t');
        if (isQuote) {
          buf.push(line);
        } else {
          if (buf.length) {
            html += `<blockquote>${buf.map(b => escapeHtml(b.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`;
            buf = [];
          }
          html += renderLine(line);
        }
      });
      if (buf.length) {
        html += `<blockquote>${buf.map(b => escapeHtml(b.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`;
      }
    }
  });
  return html;
}

// ---------- 摘要 ----------
function excerpt(body, n) {
  if (!body) return '';
  const t = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*`>\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// ---------- 时间格式化 ----------
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- 生成单篇文章的完整静态 HTML ----------
function buildPostHtml(p, prev, next) {
  const body = renderMarkdown(p.content || '');
  const author = authorName(p.author);
  const category = categoryName(p.category);
  const tags = (p.tags || []).map(t =>
    `<a class="tag" href="../#/tag/${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`
  ).join('');
  const imgs = (p.images || []).map(src =>
    `<a href="${escapeHtml(src)}" target="_blank" rel="noopener"><img src="${escapeHtml(src)}" alt="" loading="lazy"></a>`
  ).join('');

  // posts 列表已按时间倒序:上一篇=更早的(i+1),下一篇=更晚的(i-1)
  const prevHtml = prev
    ? `<a class="pn prev" href="${prev.slug}.html"><span class="pn-label">上一篇</span><span class="pn-title">${escapeHtml(prev.title || '(无题)')}</span></a>`
    : '<span class="pn placeholder"></span>';
  const nextHtml = next
    ? `<a class="pn next" href="${next.slug}.html"><span class="pn-label">下一篇</span><span class="pn-title">${escapeHtml(next.title || '(无题)')}</span></a>`
    : '<span class="pn placeholder"></span>';

  const time = formatTime(p.createdAt);
  const upd = (p.updatedAt && p.updatedAt !== p.createdAt) ? ' · 更新于 ' + formatTime(p.updatedAt) : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(p.title)} · 碎碎念留档</title>
  <meta name="description" content="${escapeHtml(excerpt(p.content, 160))}">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#5b6f8a">
  <link rel="canonical" href="${SITE_URL}posts/${encodeURIComponent(p.slug)}.html">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../assets/css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a href="../index.html" class="brand">
        <span class="brand-title">碎碎念留档</span>
        <span class="brand-sub">私人的多作者记录站</span>
      </a>
      <nav class="nav-top">
        <a href="../index.html">首页</a>
        <a href="../#/author">作者</a>
        <a href="../#/category">分类</a>
        <a href="../#/about">关于</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    <article class="post">
      <div class="card-meta">
        <span class="meta-author">${escapeHtml(author)}</span>
        <span class="meta-sep">·</span>
        <a class="meta-cat" href="../#/category/${encodeURIComponent(p.category)}">${escapeHtml(category)}</a>
        ${p.pinned ? '<span class="pin">置顶</span>' : ''}
      </div>
      <h1 class="post-title">${escapeHtml(p.title || '(无题)')}</h1>
      <div class="post-time">${time}${upd}</div>
      <div class="post-body">${body}</div>
      ${imgs ? `<div class="post-gallery">${imgs}</div>` : ''}
      ${tags ? `<div class="post-tags">${tags}</div>` : ''}
    </article>
    <nav class="prev-next">${prevHtml}${nextHtml}</nav>
  </main>
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <span>私人记录站 · 不是公开社交平台</span>
    </div>
  </footer>
</body>
</html>`;
}

// ---------- 生成 sitemap.xml ----------
function buildSitemap(visiblePosts) {
  const urls = [
    `  <url>\n    <loc>${SITE_URL}</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`,
    `  <url>\n    <loc>${SITE_URL}#/author</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
    `  <url>\n    <loc>${SITE_URL}#/category</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`
  ];
  visiblePosts.forEach(p => {
    const lastmod = p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : '';
    urls.push(`  <url>\n    <loc>${SITE_URL}posts/${encodeURIComponent(p.slug)}.html</loc>${
      lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''
    }\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// ---------- 主构建 ----------
function build() {
  if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });

  // 清理旧的静态 HTML(避免删 .md 后 .html 残留)
  fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.html'))
    .forEach(f => { try { fs.unlinkSync(path.join(POSTS_DIR, f)); } catch (e) {} });

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

  // 按 createdAt 降序(置顶优先,同级再用时间排)
  const sortFn = (a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  };
  posts.sort(sortFn);

  // 1. 写 index.json(全量,含 draft/hidden;前台 store 过滤)
  const out = { generatedAt: new Date().toISOString(), count: posts.length, posts };
  fs.writeFileSync(OUT_INDEX, JSON.stringify(out, null, 2), 'utf8');

  // 2. 每篇公开文章写静态 HTML(draft/hidden 不生成)
  const visible = posts.filter(p => !p.draft && !p.hidden);
  visible.forEach((p, i) => {
    const prev = i + 1 < visible.length ? visible[i + 1] : null;
    const next = i - 1 >= 0 ? visible[i - 1] : null;
    fs.writeFileSync(path.join(POSTS_DIR, p.slug + '.html'), buildPostHtml(p, prev, next), 'utf8');
  });

  // 3. sitemap.xml
  fs.writeFileSync(SITEMAP, buildSitemap(visible), 'utf8');

  console.log(`[build] index.json · ${posts.length} 篇(${visible.length} 篇公开已生成静态页) · sitemap.xml`);
}

build();
