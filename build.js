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
const COMMENTS_DIR = path.join(__dirname, 'comments');
const OUT_INDEX = path.join(POSTS_DIR, 'index.json');
const SITEMAP = path.join(__dirname, 'sitemap.xml');
const LLMS_TXT = path.join(__dirname, 'llms.txt');
const ALL_POSTS_HTML = path.join(__dirname, 'all-posts.html');
const FEED_XML = path.join(__dirname, 'feed.xml');
const ARCHIVES_DIR = path.join(__dirname, 'archives');
const DAILY_DIR = path.join(__dirname, 'daily');
const PLAYGROUND_DIR = path.join(__dirname, 'playground');

// 递归删除目录(重建归档用)
function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(name => {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) rimraf(p);
    else try { fs.unlinkSync(p); } catch (e) {}
  });
  try { fs.rmdirSync(dir); } catch (e) {}
}

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
// 支持字段:单行值、数组 [a, b]、列表 - item、块标量(| 或 > 多行)
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
    // 块标量:| (literal) 或 > (folded),读取后续缩进行
    if (val === '|' || val === '|-' || val === '>' || val === '>-') {
      const isFolded = val.startsWith('>');
      const blockLines = [];
      // 块标量后续行必须比 key 多一级缩进(至少 1 个空格)
      while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) {
        i++;
        blockLines.push(lines[i].replace(/^[ \t]+/, ''));
      }
      data[key] = isFolded
        ? blockLines.join(' ').trim()
        : blockLines.join('\n').trim();
      i++;
      continue;
    }
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
    .replace(/&(?!(nbsp|amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;')
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

// ---------- 加载评论 ----------
// 扫描 comments/*.md,解析 frontmatter(postId/author/date)+ 正文
// 返回 { byPost: Map<postId, Comment[]> , all: Comment[] }
function loadComments() {
  const byPost = {};
  const all = [];
  if (!fs.existsSync(COMMENTS_DIR)) return { byPost, all };
  const files = fs.readdirSync(COMMENTS_DIR).filter(f => f.endsWith('.md'));
  files.forEach(file => {
    const raw = fs.readFileSync(path.join(COMMENTS_DIR, file), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const fm = data || {};
    // 评论文件名也以 YYYY-MM-DD 开头,用它修正 frontmatter date 的日期部分
    // (Pages CMS 日期选择器可能误选月份,如 2026-59-14)
    const cFileDate = (file.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
    let cDate = fm.date || '';
    if (cFileDate && cDate) {
      const tail = String(cDate).length > 10 ? String(cDate).slice(10) : '';
      cDate = cFileDate + tail;
    } else if (cFileDate) {
      cDate = cFileDate;
    }
    const c = {
      postId: fm.postId || '',
      author: fm.author || '匿名',
      date: cDate,
      content: body
    };
    if (!c.postId) return;
    if (!byPost[c.postId]) byPost[c.postId] = [];
    byPost[c.postId].push(c);
    all.push(c);
  });
  // 每篇文章下评论按 date 升序(早的在上)
  Object.keys(byPost).forEach(k => {
    byPost[k].sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return ta - tb;
    });
  });
  return { byPost, all };
}

// ---------- 渲染评论块(单篇文章静态页用) ----------
function buildCommentsHtml(comments) {
  if (!comments || !comments.length) return '';
  const items = comments.map(c => {
    const body = renderMarkdown(c.content || '');
    const date = c.date ? formatTime(c.date).slice(0, 10) : '';
    return `<div class="comment">
      <div class="comment-meta">
        <span class="comment-author">${escapeHtml(c.author)}</span>
        ${date ? `<span class="comment-sep">·</span><span class="comment-date">${date}</span>` : ''}
      </div>
      <div class="comment-body">${body}</div>
    </div>`;
  }).join('\n');
  return `<section class="post-comments" aria-label="评论">
    <h2 class="comments-title">评论(${comments.length})</h2>
    ${items}
  </section>`;
}

// ---------- 生成单篇文章的完整静态 HTML ----------
function buildPostHtml(p, prev, next, comments) {
  // 先渲染 Markdown,再把 [PLAYGROUND_LINK] 占位替换成试玩按钮
  let body = renderMarkdown(p.content || '');
  if (p.playgroundFile) {
    // 文章页在 posts/ 下,playground 在同级 playground/ → 相对路径 ../playground/
    const pgHref = `../playground/${encodeURIComponent(p.playgroundFile)}.html`;
    body = body.replace(
      /<p>\[PLAYGROUND_LINK\]<\/p>/g,
      `<p class="playground-link"><a href="${pgHref}" target="_blank" rel="noopener">点击试玩 →</a></p>`
    );
  }
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
  const commentsHtml = buildCommentsHtml(comments || []);

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
  <link rel="alternate" type="application/rss+xml" title="碎碎念留档" href="${SITE_URL}feed.xml">
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
        <a href="../archives/">归档</a>
        <a href="../daily/">每日</a>
        <a href="../playground/">试玩</a>
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
    ${commentsHtml}
    <div class="post-id-line" data-post-id="${escapeHtml(p.slug)}">
      <span class="post-id-label">文章 ID(写评论时复制填入 postId):</span>
      <code class="post-id-value">${escapeHtml(p.slug)}</code>
      <button type="button" class="post-id-copy" data-copy="${escapeHtml(p.slug)}">复制</button>
    </div>
    <nav class="prev-next">${prevHtml}${nextHtml}</nav>
  </main>
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <span>私人记录站 · 不是公开社交平台</span>
    </div>
  </footer>
  <script>
    document.querySelectorAll('.post-id-copy').forEach(function(btn){
      btn.addEventListener('click', function(){
        var v = btn.getAttribute('data-copy');
        var done = function(){ btn.textContent='已复制'; setTimeout(function(){ btn.textContent='复制'; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(v).then(done).catch(function(){ fallbackCopy(v, done); });
        } else { fallbackCopy(v, done); }
      });
    });
    function fallbackCopy(text, cb){
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); cb(); } catch(e){}
      document.body.removeChild(ta);
    }
  </script>
</body>
</html>`;
}

// ---------- 生成 llms.txt(AI 友好的纯文本清单,按时间倒序) ----------
// 文档参考:https://llmstxt.org
// 只含标题/作者/日期/摘要/标签/单篇 URL(不含正文和评论),正文见 all-posts.html
function buildLlmsTxt(visiblePosts) {
  const lines = [];
  lines.push('# ' + '碎碎念留档');
  lines.push('');
  lines.push('> 私人的多作者记录站 · 安静、干净、偏生活化。');
  lines.push('> 作者:于加 / 江予朔 / 周叙 / 共同存档。');
  lines.push('> 内容分类:日常碎碎念 / 长文/正式记录 / 图片/相册 / 代码/创作 / 音乐/歌单 / 存档/备份。');
  lines.push('');
  lines.push('## 文章清单(按时间倒序,只含元数据与摘要,正文见 all-posts.html)');
  lines.push('');
  visiblePosts.forEach(p => {
    const url = `${SITE_URL}posts/${encodeURIComponent(p.slug)}.html`;
    const date = p.createdAt ? formatTime(p.createdAt).slice(0, 10) : '未注明';
    const author = authorName(p.author);
    const cat = categoryName(p.category);
    lines.push(`### ${p.title}`);
    lines.push(`- 作者:${author}`);
    lines.push(`- 分类:${cat}`);
    lines.push(`- 日期:${date}`);
    if (p.tags && p.tags.length) lines.push(`- 标签:${p.tags.join(', ')}`);
    lines.push(`- 摘要:${excerpt(p.content, 50) || '(无摘要)'}`);
    lines.push(`- 原文链接:${url}`);
    lines.push('');
  });
  lines.push('## 相关资源');
  lines.push('');
  lines.push(`- 全部文章正文与评论汇总(最近 10 篇全文,更早仅标题):${SITE_URL}all-posts.html`);
  lines.push('- RSS 订阅:' + SITE_URL + 'feed.xml');
  lines.push('- 站点地图:' + SITE_URL + 'sitemap.xml');
  lines.push('');
  return lines.join('\n');
}

// ---------- 生成 all-posts.html(全部公开文章归档,纯静态源码可见) ----------
// 最近 10 篇:完整正文 + 评论;更早的:仅标题 + 链接。无 JS 异步加载
const FULL_POST_LIMIT = 10;
function buildAllPostsHtml(visiblePosts, commentsByPost) {
  const fullCount = Math.min(FULL_POST_LIMIT, visiblePosts.length);
  const sections = visiblePosts.map((p, i) => {
    const url = `${SITE_URL}posts/${encodeURIComponent(p.slug)}.html`;
    const author = authorName(p.author);
    const category = categoryName(p.category);
    const time = formatTime(p.createdAt);
    const upd = (p.updatedAt && p.updatedAt !== p.createdAt) ? ' · 更新于 ' + formatTime(p.updatedAt) : '';

    // 前 N 篇:完整正文 + 评论
    if (i < FULL_POST_LIMIT) {
      const body = renderMarkdown(p.content || '');
      const tags = (p.tags || []).map(t =>
        `<a class="tag" href="#/tag/${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`
      ).join('');
      const imgs = (p.images || []).map(src =>
        `<a href="${escapeHtml(src)}" target="_blank" rel="noopener"><img src="${escapeHtml(src)}" alt="" loading="lazy"></a>`
      ).join('');
      const commentsHtml = buildCommentsHtml(commentsByPost[p.slug] || []);
      return `<article class="post" id="post-${escapeHtml(p.slug)}">
      <div class="card-meta">
        <span class="meta-author">${escapeHtml(author)}</span>
        <span class="meta-sep">·</span>
        <a class="meta-cat" href="#/category/${encodeURIComponent(p.category)}">${escapeHtml(category)}</a>
        ${p.pinned ? '<span class="pin">置顶</span>' : ''}
      </div>
      <h2 class="post-title"><a href="${url}">${escapeHtml(p.title || '(无题)')}</a></h2>
      <div class="post-time">${time}${upd}</div>
      <div class="post-body">${body}</div>
      ${imgs ? `<div class="post-gallery">${imgs}</div>` : ''}
      ${tags ? `<div class="post-tags">${tags}</div>` : ''}
      ${commentsHtml}
      <p class="post-permalink">原文链接:<a href="${url}">${url}</a></p>
    </article>`;
    }

    // 更早的:仅标题 + 链接
    return `<article class="post post-compact" id="post-${escapeHtml(p.slug)}">
      <div class="card-meta">
        <span class="meta-author">${escapeHtml(author)}</span>
        <span class="meta-sep">·</span>
        <a class="meta-cat" href="#/category/${encodeURIComponent(p.category)}">${escapeHtml(category)}</a>
      </div>
      <h2 class="post-title"><a href="${url}">${escapeHtml(p.title || '(无题)')}</a></h2>
      <div class="post-time">${time}</div>
      <p class="post-excerpt">${escapeHtml(p.excerpt || '')}</p>
      <p class="post-permalink"><a href="${url}">阅读全文 →</a></p>
    </article>`;
  }).join('\n');

  const summaryNote = visiblePosts.length > fullCount
    ? `最近 ${fullCount} 篇含完整正文与评论,更早 ${visiblePosts.length - fullCount} 篇仅标题与链接。`
    : `全部 ${visiblePosts.length} 篇含完整正文与评论。`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>全部文章归档 · 碎碎念留档</title>
  <meta name="description" content="本站全部文章归档,共 ${visiblePosts.length} 篇,${summaryNote}">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#5b6f8a">
  <link rel="canonical" href="${SITE_URL}all-posts.html">
  <link rel="alternate" type="application/rss+xml" title="碎碎念留档" href="${SITE_URL}feed.xml">
  <link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a href="index.html" class="brand">
        <span class="brand-title">碎碎念留档</span>
        <span class="brand-sub">全部文章归档 · ${visiblePosts.length} 篇</span>
      </a>
      <nav class="nav-top">
        <a href="index.html">首页</a>
        <a href="#/author">作者</a>
        <a href="#/category">分类</a>
        <a href="archives/">归档</a>
        <a href="daily/">每日</a>
        <a href="playground/">试玩</a>
        <a href="#/about">关于</a>
      </nav>
    </div>
  </header>
  <div class="wrap">
    <section class="block">
      <h1 class="block-title">全部文章归档</h1>
      <p class="block-sub">共 ${visiblePosts.length} 篇 · ${summaryNote}</p>
    </section>
    ${sections}
  </main>
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <span>私人记录站 · 不是公开社交平台</span>
    </div>
  </footer>
</body>
</html>`;
}

// ---------- 时间戳 W3C Datetime(带时区,供 sitemap/feed lastmod 用) ----------
// 格式:2026-09-14T18:00:00+08:00 (东八区)
function lastmodW3C(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  // +08:00 时区:UTC 时间 + 8 小时
  const local = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}+08:00`;
}

// ---------- 按月分组(返回 [{ ym: '2026-09', posts: [...] }],按月份倒序,文章也倒序) ----------
function groupByMonth(visiblePosts) {
  const map = {};
  visiblePosts.forEach(p => {
    if (!p.createdAt) return;
    const d = new Date(p.createdAt);
    if (isNaN(d)) return;
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map[ym]) map[ym] = [];
    map[ym].push(p);
  });
  return Object.keys(map).sort().reverse().map(ym => {
    const posts = map[ym].slice().sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    // 该月最新文章的更新时间作为归档页 lastmod
    const latest = posts[0] || null;
    const lm = latest ? (latest.updatedAt || latest.createdAt) : '';
    return { ym, posts, lastmod: lm };
  });
}

// ---------- 按天分组(返回 [{ ymd: '2026-09-13', posts: [...] }],按日期倒序,文章也倒序) ----------
// 日期直接取 frontmatter 的 YYYY-MM-DD,不做时区转换
function groupByDay(visiblePosts) {
  const map = {};
  visiblePosts.forEach(p => {
    if (!p.createdAt) return;
    // 直接取日期字符串前 10 位(YYYY-MM-DD),不做 Date 时区转换,避免跨天
    const ymd = String(p.createdAt).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    if (!map[ymd]) map[ymd] = [];
    map[ymd].push(p);
  });
  return Object.keys(map).sort().reverse().map(ymd => {
    const posts = map[ymd].slice().sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    return { ymd, posts };
  });
}

// ---------- 生成 daily/YYYY-MM-DD.txt(纯文本,当天所有文章 + 评论) ----------
// 格式:日期 / 每篇【标题/作者/正文/评论】;评论按文章归属,不平铺
function buildDailyTxt(ymd, posts, commentsByPost) {
  const lines = [];
  lines.push(`日期:${ymd}`);
  lines.push('');
  posts.forEach((p, i) => {
    const author = authorName(p.author);
    const body = (p.content || '').trim();
    lines.push(`【文章${i + 1}】`);
    lines.push(`标题:${p.title || '(无题)'}`);
    lines.push(`作者:${author}`);
    lines.push('正文:');
    lines.push(body);
    lines.push('');
    const cs = commentsByPost[p.slug] || [];
    if (cs.length) {
      lines.push('评论:');
      cs.forEach(c => {
        const ctext = (c.content || '').replace(/[#>*`]/g, ' ').replace(/\s+/g, ' ').trim();
        lines.push(`- ${c.author}:${ctext}`);
      });
    } else {
      lines.push('评论:(暂无)');
    }
    lines.push('');
  });
  return lines.join('\n');
}

// ---------- 生成 daily/index.html(每日 AI 阅读包入口,链接直指 .txt 本身) ----------
function buildDailyIndex(days) {
  const items = days.map(d => {
    const ymd = d.ymd;
    const count = d.posts.length;
    return `<li class="archive-item daily-item">
      <a href="${ymd}.txt" download>${ymd}.txt</a>
      <span class="archive-count">(${count} 篇文章)</span>
    </li>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>每日 AI 阅读包 · 碎碎念留档</title>
  <meta name="description" content="按日期聚合的纯文本包,可直接下载发给 AI 阅读,共 ${days.length} 天。">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#5b6f8a">
  <link rel="canonical" href="${SITE_URL}daily/">
  <link rel="alternate" type="application/rss+xml" title="碎碎念留档" href="${SITE_URL}feed.xml">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../assets/css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a href="../index.html" class="brand">
        <span class="brand-title">碎碎念留档</span>
        <span class="brand-sub">每日 AI 阅读包</span>
      </a>
      <nav class="nav-top">
        <a href="../index.html">首页</a>
        <a href="../#/author">作者</a>
        <a href="../#/category">分类</a>
        <a href="../archives/">归档</a>
        <a href="index.html">每日</a>
        <a href="../playground/">试玩</a>
        <a href="../#/about">关于</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    <section class="block">
      <h1 class="block-title">每日 AI 阅读包</h1>
      <p class="block-sub">每天一个纯文本包,含当天所有文章的标题/作者/正文/评论。点击下载当天 .txt,可直接发给 AI 阅读。共 ${days.length} 天。</p>
    </section>
    <ul class="archive-list daily-list">${items}</ul>
  </main>
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <span>私人记录站 · 不是公开社交平台</span>
    </div>
  </footer>
</body>
</html>`;
}

// ---------- 生成 feed.xml(RSS 2.0) ----------
// 每条含:标题/链接/pubDate(发布时间)/lastmod(最后修改时间)
function buildFeedXml(visiblePosts) {
  const toRFC822 = iso => {
    if (!iso) return new Date().toUTCString();
    const d = new Date(iso);
    return isNaN(d) ? new Date().toUTCString() : d.toUTCString();
  };
  const buildDate = new Date().toUTCString();
  const items = visiblePosts.slice(0, 20).map(p => {
    const url = `${SITE_URL}posts/${encodeURIComponent(p.slug)}.html`;
    const cat = categoryName(p.category);
    const pub = toRFC822(p.createdAt);
    const lm = lastmodW3C(p.updatedAt || p.createdAt);
    // 正文用纯文本(去 markdown 标记),避免 CDATA 转义麻烦
    const text = (p.excerpt || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `    <item>
      <title>${escapeHtml(p.title || '(无题)')}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pub}</pubDate>
      <lastmod>${lm}</lastmod>
      <description>${text}</description>
      <category>${escapeHtml(cat)}</category>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>碎碎念留档</title>
    <link>${SITE_URL}</link>
    <description>私人的多作者记录站 · 安静、干净、偏生活化。</description>
    <language>zh-CN</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

// ---------- 生成按月归档索引页(archives/index.html):列出所有月份 ----------
function buildArchiveIndex(months) {
  const items = months.map(m => {
    const ym = m.ym;
    const count = m.posts.length;
    const lm = lastmodW3C(m.lastmod);
    return `<li class="archive-month">
      <a href="${ym}/index.html">${ym}</a>
      <span class="archive-count">(${count} 篇)${lm ? ` · 更新 ${lm.slice(0, 10)}` : ''}</span>
    </li>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>按月归档 · 碎碎念留档</title>
  <meta name="description" content="按月份归档的全部文章,共 ${months.length} 个月。">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#5b6f8a">
  <link rel="canonical" href="${SITE_URL}archives/">
  <link rel="alternate" type="application/rss+xml" title="碎碎念留档" href="${SITE_URL}feed.xml">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../assets/css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a href="../index.html" class="brand">
        <span class="brand-title">碎碎念留档</span>
        <span class="brand-sub">按月归档</span>
      </a>
      <nav class="nav-top">
        <a href="../index.html">首页</a>
        <a href="../#/author">作者</a>
        <a href="../#/category">分类</a>
        <a href="index.html">归档</a>
        <a href="../daily/">每日</a>
        <a href="../playground/">试玩</a>
        <a href="../#/about">关于</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    <section class="block">
      <h1 class="block-title">按月归档</h1>
      <p class="block-sub">共 ${months.length} 个月,点击进入该月文章列表。</p>
    </section>
    <ul class="archive-list">${items}</ul>
  </main>
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <span>私人记录站 · 不是公开社交平台</span>
    </div>
  </footer>
</body>
</html>`;
}

// ---------- 生成单个月份归档页(archives/YYYY-MM/index.html):列出该月所有文章 ----------
function buildArchiveMonth(ym, posts) {
  const items = posts.map(p => {
    const url = `${SITE_URL}posts/${encodeURIComponent(p.slug)}.html`;
    const author = authorName(p.author);
    const time = formatTime(p.createdAt);
    return `<li class="archive-item">
      <a href="../../posts/${encodeURIComponent(p.slug)}.html">${escapeHtml(p.title || '(无题)')}</a>
      <span class="meta-author">${escapeHtml(author)}</span>
      <span class="post-time">${time}</span>
    </li>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ym} 归档 · 碎碎念留档</title>
  <meta name="description" content="${ym} 的全部文章,共 ${posts.length} 篇。">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#5b6f8a">
  <link rel="canonical" href="${SITE_URL}archives/${ym}/index.html">
  <link rel="alternate" type="application/rss+xml" title="碎碎念留档" href="${SITE_URL}feed.xml">
  <link rel="icon" href="../../assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../../assets/css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a href="../../index.html" class="brand">
        <span class="brand-title">碎碎念留档</span>
        <span class="brand-sub">${ym} 归档</span>
      </a>
      <nav class="nav-top">
        <a href="../../index.html">首页</a>
        <a href="../../#/author">作者</a>
        <a href="../../#/category">分类</a>
        <a href="../index.html">归档</a>
        <a href="../../daily/">每日</a>
        <a href="../../playground/">试玩</a>
        <a href="../../#/about">关于</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    <section class="block">
      <h1 class="block-title">${ym} 归档</h1>
      <p class="block-sub">本月 ${posts.length} 篇文章。</p>
    </section>
    <ul class="archive-list">${items}</ul>
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
// lastmod 用 W3C Datetime(带时区),含文章、归档页、每日聚合、feed.xml、llms.txt、all-posts.html
function buildSitemap(visiblePosts, months, days) {
  const urlEntry = (loc, opts) => {
    const parts = [`    <loc>${loc}</loc>`];
    if (opts.lastmod) parts.push(`    <lastmod>${opts.lastmod}</lastmod>`);
    if (opts.changefreq) parts.push(`    <changefreq>${opts.changefreq}</changefreq>`);
    if (opts.priority) parts.push(`    <priority>${opts.priority}</priority>`);
    return `  <url>\n${parts.join('\n')}\n  </url>`;
  };
  const now = lastmodW3C(new Date().toISOString());
  const urls = [
    urlEntry(`${SITE_URL}`, { lastmod: now, changefreq: 'daily', priority: '1.0' }),
    urlEntry(`${SITE_URL}all-posts.html`, { lastmod: now, changefreq: 'daily', priority: '0.9' }),
    urlEntry(`${SITE_URL}llms.txt`, { lastmod: now, changefreq: 'weekly', priority: '0.9' }),
    urlEntry(`${SITE_URL}feed.xml`, { lastmod: now, changefreq: 'daily', priority: '0.9' }),
    urlEntry(`${SITE_URL}archives/`, { lastmod: now, changefreq: 'weekly', priority: '0.7' }),
    urlEntry(`${SITE_URL}daily/`, { lastmod: now, changefreq: 'weekly', priority: '0.7' })
  ];
  // 每月归档页
  months.forEach(m => {
    const lm = lastmodW3C(m.lastmod) || now;
    urls.push(urlEntry(`${SITE_URL}archives/${m.ym}/index.html`, {
      lastmod: lm, changefreq: 'monthly', priority: '0.6'
    }));
  });
  // 每日聚合 txt(只列有文章的天)
  days.forEach(d => {
    const lm = lastmodW3C(d.posts[0] ? (d.posts[0].updatedAt || d.posts[0].createdAt) : '') || now;
    urls.push(urlEntry(`${SITE_URL}daily/${d.ymd}.txt`, {
      lastmod: lm, changefreq: 'monthly', priority: '0.6'
    }));
  });
  // 每篇文章
  visiblePosts.forEach(p => {
    const lm = lastmodW3C(p.updatedAt || p.createdAt);
    urls.push(urlEntry(`${SITE_URL}posts/${encodeURIComponent(p.slug)}.html`, {
      lastmod: lm, changefreq: 'monthly', priority: '0.8'
    }));
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// ---------- 可交互代码(playground) ----------

// 生成 URL 安全的短文件名:用日期前缀 + 标题 hash,不含中文
function safePlaygroundName(slug, title) {
  const dateMatch = slug.match(/^(\d{4}-\d{2}-\d{2})/);
  const dateStr = dateMatch ? dateMatch[1] : 'unknown';
  // 用标题做简单 hash(6 位)
  const src = title || slug;
  let h = 0;
  for (let i = 0; i < src.length; i++) {
    h = ((h << 5) - h + src.charCodeAt(i)) | 0;
  }
  const hash = Math.abs(h).toString(36).slice(0, 6).padStart(6, '0');
  return `${dateStr}-${hash}`;
}

// 检测 playable 内容里裸露的 JS 代码(Pages CMS 吞掉了 <script> 标签)
// 特征: 有明显 JS 标志但没有完整的 <script>...</script> 标签对
function detectBareScript(content) {
  // 用完整的标签对检测: 必须有 <script...> 和对应的 </script>
  const hasScriptTagPair = /<script[^>]*>[\s\S]*<\/script>/i.test(content);
  if (hasScriptTagPair) return null; // 已有完整 script 标签对,不用处理
  // 找 IIFE 开头 (function() { ... })() 或 !function(){}
  const iifeRe = /(?:^|\n)\s*(\(?function\s*\([^)]*\)\s*\{[\s\S]*?\}\s*\)\s*\(\)\s*;?)/;
  const iife = content.match(iifeRe);
  if (iife && iife[1].length > 50) return iife[1].trim();
  // 找以 var / let / const CONFIG 开头,且包含 Pages CMS 规避写法的
  if (/var\s+\w+\s*=\s*\{[\s\S]{100,}document\['|window\['|Math\['|setTimeout/.test(content)) {
    // 从第一个 (function 或 var 开始到末尾
    const startRe = /(?:\(function\s*\(|var\s+\w+\s*=\s*\{|function\s+\w+\s*\()/;
    const idx = content.search(startRe);
    if (idx > 0) return content.slice(idx).trim();
  }
  return null;
}

// 包装裸露的 JS → 加 <script> 标签; 包装裸露的 CSS → 加 <style> 标签
// 同时自动补 buildPlaygroundPage 的容器内联样式(保证 playable 在 playground 页正常显示)
function wrapBareTags(content) {
  let result = content;
  let changed = false;
  // 自动包裹 JS
  const bareJs = detectBareScript(result);
  if (bareJs) {
    result = result.replace(bareJs, '<script>\n' + bareJs + '\n</script>');
    changed = true;
  }
  // 自动包裹 CSS: 检测到明显的 CSS 规则块但没有完整 <style> 标签对
  const hasStyleTagPair = /<style[^>]*>[\s\S]*<\/style>/i.test(result);
  if (!hasStyleTagPair && /[.#][\w-]+\s*\{[^}]{10,}\}/.test(result)) {
    // 找第一个 CSS 规则的位置
    const cssRe = /([.#][\w-]+\s*\{[\s\S]*?\})/;
    const idx = result.search(cssRe);
    if (idx >= 0) {
      // 从 idx 之前截取到合适位置(换行),把 CSS 部分包进 <style>
      const before = result.slice(0, idx).replace(/\s+$/, '');
      const after = result.slice(idx);
      result = before + '\n\n<style>\n' + after + '\n</style>';
      changed = true;
    }
  }
  return changed ? result : content;
}

// 从文章正文提取 playable 内容,返回 { content, bodyWithoutBlock }
// 优先取正文 <!-- playable -->...<!-- /playable --> 标记;
// 其次取 frontmatter playable_html 字段;
// 兜底: 如果标记被 Pages CMS 吃掉了,尝试从分散的 ``` 代码块里重组 playable 内容
function extractPlayable(body, fm) {
  const markerRe = /<!--\s*playable\s*-->([\s\S]*?)<!--\s*\/playable\s*-->/;
  const m = body.match(markerRe);
  if (m) {
    let content = m[1].trim();
    // Pages CMS 可能吞掉了 <script> / <style> 标签,尝试自动补
    const fixed = wrapBareTags(content);
    const needsRepair = fixed !== content;
    return {
      content: fixed,
      // 把标记块替换成一行占位,后面 renderMarkdown 会渲染成 <p>
      body: body.replace(markerRe, '\n\n[PLAYGROUND_LINK]\n\n'),
      needsRepair
    };
  }
  if (fm && fm.playable_html) {
    return {
      content: String(fm.playable_html).trim(),
      body: body + '\n\n[PLAYGROUND_LINK]\n\n'
    };
  }
  // 兜底: 检测 Pages CMS 吃掉标记后留下的碎片代码块
  // 条件: 文章包含 <script 或 <style 标签(说明原本是 playable)
  const hasScript = /<script[\s>]/i.test(body);
  const hasStyle = /<style[\s>]/i.test(body);
  if (hasScript || hasStyle) {
    // 把所有 ``` 代码块内容拼接起来,过滤掉纯文字说明
    const codeBlockRe = /```(?:html|css|js|javascript)?\s*\n([\s\S]*?)```/g;
    const parts = [];
    let cm;
    while ((cm = codeBlockRe.exec(body)) !== null) {
      const chunk = cm[1].trim();
      // 只收集包含 HTML/CSS/JS 特征的代码块
      if (/<(script|style|div|canvas|button|h[1-6]|span|p|svg)[\s>]/i.test(chunk) ||
          /function\s+\w+|document\.|getElementById|addEventListener/i.test(chunk)) {
        parts.push(chunk);
      }
    }
    if (parts.length > 0) {
      const content = parts.join('\n\n').trim();
      return {
        content,
        // 把所有代码块替换成占位
        body: body.replace(codeBlockRe, '\n').replace(/\n{3,}/g, '\n\n') + '\n\n[PLAYGROUND_LINK]\n\n',
        needsRepair: true  // 告诉上层 md 文件需要写回修复
      };
    }
  }
  return null;
}

// 生成独立 playground HTML 页面
function buildPlaygroundPage(playContent, p) {
  // 转义 <!-- 避免 HTML 注释截断(但 script 标签里的代码是合法的,不需要转义)
  // 只处理一种情况:内容里如果有 </script> 在它该在的位置就是正常的
  // 唯一需要处理的是:如果内容本身不含 <html>/<head>/<body>,我们给它套一层模板
  const hasHtmlTag = /<html[\s>]/i.test(playContent);
  if (hasHtmlTag) {
    // 内容已经是完整 HTML 文档,直接输出
    return playContent;
  }
  const title = escapeHtml(p.title || '试玩');
  const author = escapeHtml(authorName(p.author));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${title} · 试玩 · 碎碎念留档</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <style>
    body { margin: 0; padding: 16px 16px 48px; font-family: system-ui, -apple-system, sans-serif; background: #fafafa; color: #333; }
    .pg-back { display: block; margin-bottom: 8px; font-size: 14px; color: #5b6f8a; text-decoration: none; }
    .pg-meta { display: block; font-size: 12px; color: #999; margin: 0 0 16px; }
    .pg-canvas { border: 1px solid #e0e0e0; border-radius: 8px; overflow: auto; }
    button { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  </style>
</head>
<body>
  <a class="pg-back" href="../posts/${encodeURIComponent(p.slug)}.html">← 返回文章</a>
  <div class="pg-meta">${title} · ${author}</div>
  <div class="pg-canvas">
${playContent}
  </div>
</body>
</html>`;
}

// 生成 playground/index.html 列表页
function buildPlaygroundIndex(items) {
  const rows = items.map(item => {
    const title = escapeHtml(item.title);
    const date = item.createdAt || '';
    const exc = escapeHtml(excerpt(item.excerpt || '', 100));
    const author = escapeHtml(authorName(item.author));
    return `      <div class="pg-item">
        <a href="${item.file}.html"><strong>${title}</strong></a>
        <span class="pg-item-date">${date}</span>
        <span class="pg-item-author">${author}</span>
        <p class="pg-item-excerpt">${exc}</p>
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>试玩 · 碎碎念留档</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../assets/css/style.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a href="../index.html" class="brand">
        <span class="brand-title">碎碎念留档</span>
        <span class="brand-sub">可交互代码 / 试玩</span>
      </a>
      <nav class="nav-top">
        <a href="../index.html">首页</a>
        <a href="../#/author">作者</a>
        <a href="../#/category">分类</a>
        <a href="../archives/">归档</a>
        <a href="../daily/">每日</a>
        <a href="index.html">试玩</a>
        <a href="../#/about">关于</a>
      </nav>
    </div>
  </header>
  <main class="wrap">
    <h1>试玩 / 可交互代码</h1>
    <p class="muted">以下是带有可交互 HTML/JS 代码的文章,点击进入即可在线体验。</p>
${rows || '    <p>暂无试玩内容。</p>'}
  </main>
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <span>私人记录站 · 不是公开社交平台</span>
    </div>
  </footer>
</body>
</html>`;
}

// ---------- 主构建 ----------
function build() {
  if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });

  // 清理旧的静态 HTML(避免删 .md 后 .html 拮留)
  fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.html'))
    .forEach(f => { try { fs.unlinkSync(path.join(POSTS_DIR, f)); } catch (e) {} });

  // ---------- 自动重命名坏文件名 ----------
  // Pages CMS 的 filename 模板在标题未填时生成空标题文件名,
  // 如 2026-09-15-.md 或 2026-09-15--1.md。
  // 这里在构建前自动用 frontmatter 里的 title + author 重命名。
  const badNameRe = /^(\d{4}-\d{2}-\d{2})(-?(-?\d+)?)(\.md)$/;
  fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md'))
    .forEach(f => {
      // 检测:文件名在日期后紧跟 .md(空标题),或 --N.md(空标题+序号)
      const m = f.match(/^(\d{4}-\d{2}-\d{2})-(\.md)$/);
      const m2 = f.match(/^(\d{4}-\d{2}-\d{2})--(\d+)(\.md)$/);
      if (!m && !m2) return;
      const dateStr = (m || m2)[1];
      const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf8');
      const { data } = parseFrontmatter(raw);
      const fm = data || {};
      const titleSlug = (fm.title || 'untitled')
        .replace(/[^\w\u4e00-\u9fff]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
      const authorSlug = fm.author || 'post';
      const newName = `${dateStr}-${authorSlug}-${titleSlug}.md`;
      if (newName === f) return;
      fs.renameSync(path.join(POSTS_DIR, f), path.join(POSTS_DIR, newName));
      console.log(`[自动重命名] ${f} → ${newName}`);
    });

  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  const posts = files.map(file => {
    const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const slug = file.replace(/\.md$/, '');
    const fm = data || {};
    // 文件名里的日期才是真相(Pages CMS 生成文件名时用当天日期,
    // 但 frontmatter 的 createdAt 日期选择器可能被误选到别的月份)。
    // 若文件名以 YYYY-MM-DD 开头,就用它覆盖 createdAt 的日期部分,
    // 时分秒仍保留 frontmatter 的值(没有就用 00:00:00)。
    const fileDateMatch = slug.match(/^(\d{4}-\d{2}-\d{2})/);
    const fileDate = fileDateMatch ? fileDateMatch[1] : null;
    function normalizeDate(fmVal) {
      if (!fmVal) return fileDate || null;
      if (!fileDate) return fmVal;
      const s = String(fmVal);
      // 只保留日期之后的部分(T 或空格 + 时分秒),与文件名日期拼接
      const tail = s.length > 10 ? s.slice(10) : '';
      return fileDate + tail;
    }
    // 提取可交互代码(playable)
    const play = extractPlayable(body, fm);
    let contentBody = body;
    let playgroundFile = null;
    if (play) {
      contentBody = play.body;
      playgroundFile = safePlaygroundName(slug, fm.title || slug);
      // Pages CMS 吃掉了 playable 标记,自动修复 md 文件
      if (play.needsRepair) {
        // 从原始 raw 里提取 frontmatter 块(---...---)
        const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---/);
        const fmBlock = fmMatch ? fmMatch[0] : '---\ntitle: ' + (fm.title || slug) + '\n---';
        // 重建 md: frontmatter + 修复后的 body(把碎片代码块包回 playable 标记)
        const repairedBody = play.body.replace(
          /\[PLAYGROUND_LINK\]/g,
          '<!-- playable -->\n\n' + play.content + '\n\n<!-- /playable -->'
        );
        const repaired = fmBlock + '\n\n' + repairedBody.trim() + '\n';
        const fp = path.join(POSTS_DIR, file);
        fs.writeFileSync(fp, repaired, 'utf8');
        console.log(`[auto-fix] 修复 ${fp}: 恢复 playable 标记`);
      }
    }
    // 摘要从 contentBody 取(已移除 playable 块),避免泄漏原始 HTML/CSS/JS
    const excerptBody = contentBody.replace(/\[PLAYGROUND_LINK\]/g, '');
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
      createdAt: normalizeDate(fm.createdAt),
      updatedAt: normalizeDate(fm.updatedAt),
      excerpt: excerpt(excerptBody, 160),
      content: contentBody,
      playgroundFile,
      playgroundContent: play ? play.content : null
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

  // 2. 加载评论,按 postId 索引
  const { byPost: commentsByPost, all: allComments } = loadComments();

  // 3. 每篇公开文章写静态 HTML(评论拼到正文下方)
  const visible = posts.filter(p => !p.draft && !p.hidden);
  visible.forEach((p, i) => {
    const prev = i + 1 < visible.length ? visible[i + 1] : null;
    const next = i - 1 >= 0 ? visible[i - 1] : null;
    fs.writeFileSync(
      path.join(POSTS_DIR, p.slug + '.html'),
      buildPostHtml(p, prev, next, commentsByPost[p.slug] || []),
      'utf8'
    );
  });

  // 4. llms.txt(只含元数据与摘要,不含正文/评论)
  fs.writeFileSync(LLMS_TXT, buildLlmsTxt(visible), 'utf8');

  // 5. all-posts.html(最近 10 篇全文 + 评论,更早仅标题)
  fs.writeFileSync(ALL_POSTS_HTML, buildAllPostsHtml(visible, commentsByPost), 'utf8');

  // 6. feed.xml(RSS 2.0,静态文件 GitHub Pages 自动支持 304)
  fs.writeFileSync(FEED_XML, buildFeedXml(visible), 'utf8');

  // 7. 按月归档(archives/index.html + archives/YYYY-MM/index.html)
  rimraf(ARCHIVES_DIR);
  const months = groupByMonth(visible);
  fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARCHIVES_DIR, 'index.html'), buildArchiveIndex(months), 'utf8');
  months.forEach(m => {
    const dir = path.join(ARCHIVES_DIR, m.ym);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), buildArchiveMonth(m.ym, m.posts), 'utf8');
  });

  // 8. 按天聚合(daily/YYYY-MM-DD.txt + daily/index.html)
  rimraf(DAILY_DIR);
  const days = groupByDay(visible);
  fs.mkdirSync(DAILY_DIR, { recursive: true });
  fs.writeFileSync(path.join(DAILY_DIR, 'index.html'), buildDailyIndex(days), 'utf8');
  days.forEach(d => {
    fs.writeFileSync(path.join(DAILY_DIR, d.ymd + '.txt'), buildDailyTxt(d.ymd, d.posts, commentsByPost), 'utf8');
  });

  // 9. sitemap.xml(含文章/归档页/daily/feed 的 lastmod,W3C Datetime 带时区)
  fs.writeFileSync(SITEMAP, buildSitemap(visible, months, days), 'utf8');

  // 10. 可交互代码 playground
  // 只清理自动生成的文件(日期-hash.html + index.html),保留手工放置的工具页(如 gacha-*.html)
  const generatedRe = /^\d{4}-\d{2}-\d{2}-[0-9a-z]+\.html$/;
  fs.mkdirSync(PLAYGROUND_DIR, { recursive: true });
  if (fs.existsSync(PLAYGROUND_DIR)) {
    fs.readdirSync(PLAYGROUND_DIR).forEach(name => {
      const p = path.join(PLAYGROUND_DIR, name);
      if (fs.statSync(p).isDirectory()) {
        rimraf(p);
      } else if (generatedRe.test(name) || name === 'index.html') {
        try { fs.unlinkSync(p); } catch (e) {}
      }
    });
  }
  const playItems = [];
  visible.forEach(p => {
    if (!p.playgroundFile || !p.playgroundContent) return;
    const html = buildPlaygroundPage(p.playgroundContent, p);
    fs.writeFileSync(path.join(PLAYGROUND_DIR, p.playgroundFile + '.html'), html, 'utf8');
    playItems.push({
      file: p.playgroundFile,
      title: p.title,
      author: p.author,
      createdAt: p.createdAt,
      excerpt: p.excerpt
    });
  });
  // 扫描手工放置的工具页(不匹配 generatedRe 的 .html),加入索引
  const toolFiles = fs.readdirSync(PLAYGROUND_DIR)
    .filter(f => f.endsWith('.html') && f !== 'index.html' && !generatedRe.test(f));
  toolFiles.forEach(f => {
    const raw = fs.readFileSync(path.join(PLAYGROUND_DIR, f), 'utf8');
    // 从 <title> 标签提取标题
    const titleMatch = raw.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : f.replace(/\.html$/, '');
    playItems.push({
      file: f.replace(/\.html$/, ''),
      title,
      author: '工具',
      createdAt: '',
      excerpt: '可交互小工具'
    });
  });
  fs.writeFileSync(path.join(PLAYGROUND_DIR, 'index.html'), buildPlaygroundIndex(playItems), 'utf8');

  console.log(`[build] index.json · ${posts.length} 篇(${visible.length} 篇公开) · 评论 ${allComments.length} 条 · 静态页 ×${visible.length} · llms.txt · all-posts.html · feed.xml · 归档 ×${months.length} 月 · 每日 ×${days.length} 天 · playground ×${playItems.length} · sitemap.xml`);
}

build();
