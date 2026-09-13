// 前台渲染:首页、作者、分类、详情、关于,以及通用 UI 工具
// 全部页面函数都是 async,内部 await 数据请求
(function () {
  const cfg = window.DiaryConfig;
  const store = window.DiaryStore;
  const md = window.DiaryMD;
  const router = window.DiaryRouter;
  const view = () => document.getElementById('view');

  // ---------- 通用 UI ----------
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    el.className = 'toast show ' + (type || '');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => {
      el.hidden = true;
      el.className = 'toast';
    }, 2400);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fmtDateShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function authorName(id) {
    return (cfg.authorById(id) || {}).name || id;
  }
  function categoryName(id) {
    return (cfg.categoryById(id) || {}).name || id;
  }

  function excerpt(text, n) {
    if (!text) return '';
    const t = text.replace(/```[\s\S]*?```/g, '').replace(/[#>*`]/g, '').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function h(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function pager(current, total, buildHref) {
    if (total <= 1) return '';
    let html = '<div class="pager">';
    for (let i = 1; i <= total; i++) {
      html += `<a class="${i === current ? 'active' : ''}" href="${buildHref(i)}">${i}</a>`;
    }
    html += '</div>';
    return html;
  }

  // ---------- 组件:文章卡片 ----------
  function postCard(p) {
    const cover = (p.images && p.images[0]) ? `<div class="card-cover"><img src="${h(p.images[0])}" alt="" loading="lazy"></div>` : '';
    const tags = (p.tags || []).map(t => `<a href="#/tag/${encodeURIComponent(t)}" class="tag">#${h(t)}</a>`).join('');
    return `<article class="card">
      ${cover}
      <div class="card-body">
        <div class="card-meta">
          <span class="meta-author">${h(authorName(p.author))}</span>
          <span class="meta-sep">·</span>
          <a class="meta-cat" href="#/category/${p.category}">${h(categoryName(p.category))}</a>
          ${p.pinned ? '<span class="pin">置顶</span>' : ''}
        </div>
        <h3 class="card-title"><a href="#/post/${p.slug || p.id}">${h(p.title || '(无题)')}</a></h3>
        <p class="card-excerpt">${h(excerpt(p.content, 120))}</p>
        <div class="card-foot">
          <span class="meta-time">${fmtDateShort(p.createdAt)}</span>
          <span class="meta-tags">${tags}</span>
        </div>
      </div>
    </article>`;
  }

  // ---------- 页面:首页 ----------
  async function pageHome(args, params) {
    const data = await store.posts.listPublic({ pageSize: 50 });
    const list = data.list || [];
    const pinned = list.filter(p => p.pinned).slice(0, 3);
    const latest = list.slice(0, cfg.pageSize);

    let html = '<section class="hero">';
    html += `<h1>${h(cfg.siteTitle)}</h1><p>${h(cfg.siteSubtitle)}</p>`;
    html += '</section>';

    if (pinned.length) {
      html += '<section class="block"><h2 class="block-title">置顶</h2><div class="cards">';
      html += pinned.map(postCard).join('');
      html += '</div></section>';
    }

    html += '<section class="block"><h2 class="block-title">分类</h2><div class="chips">';
    cfg.categories.forEach(c => {
      html += `<a class="chip" href="#/category/${c.id}">${h(c.name)}</a>`;
    });
    html += '</div></section>';

    html += '<section class="block"><h2 class="block-title">作者</h2><div class="chips">';
    cfg.authors.forEach(a => {
      html += `<a class="chip" href="#/author/${a.id}">${h(a.name)}</a>`;
    });
    html += '</div></section>';

    html += '<section class="block"><h2 class="block-title">最新</h2><div class="cards">';
    if (latest.length) html += latest.map(postCard).join('');
    else html += '<p class="empty">还没有内容。</p>';
    html += '</div>';

    if (list.length > cfg.pageSize) {
      html += `<div class="block-more"><a class="btn" href="#/list">查看全部 ${list.length} 条</a></div>`;
    }
    html += '</section>';

    view().innerHTML = html;
  }

  // ---------- 页面:全部列表 ----------
  async function pageList(args, params) {
    const page = parseInt(params.page || '1', 10) || 1;
    const data = await store.posts.listPublic({ page, pageSize: cfg.pageSize });
    const list = data.list || [];
    const total = Math.ceil((data.total || list.length) / cfg.pageSize);

    let html = `<section class="block"><h2 class="block-title">全部内容</h2>`;
    html += `<p class="block-sub">共 ${data.total || list.length} 条</p>`;
    html += '<div class="cards">';
    if (list.length) html += list.map(postCard).join('');
    else html += '<p class="empty">还没有内容。</p>';
    html += '</div>';
    html += pager(page, total, i => `#/list?page=${i}`);
    html += '</section>';
    view().innerHTML = html;
  }

  // ---------- 页面:作者页 ----------
  async function pageAuthorIndex() {
    const counts = await store.posts.counts();
    const countBy = id => counts.byAuthor[id] || 0;

    let html = '<section class="block"><h2 class="block-title">作者</h2>';
    html += '<div class="author-list">';
    cfg.authors.forEach(a => {
      html += `<a class="author-card" href="#/author/${a.id}">
        <h3>${h(a.name)}</h3>
        <p>${h(a.desc)}</p>
        <span class="count">${countBy(a.id)} 条</span>
      </a>`;
    });
    html += '</div></section>';
    view().innerHTML = html;
  }

  async function pageAuthor(args) {
    const a = cfg.authorById(args.id);
    if (!a) return view().innerHTML = '<p>没有这个作者。</p>';
    const data = await store.posts.listPublic({ author: a.id, pageSize: 1000 });
    const list = data.list || [];
    let html = `<section class="block">
      <p class="crumb"><a href="#/author">作者</a> / ${h(a.name)}</p>
      <h2 class="block-title">${h(a.name)}</h2>
      <p class="block-sub">${h(a.desc)} · ${list.length} 条</p>`;
    html += '<div class="cards">';
    if (list.length) html += list.slice(0, 30).map(postCard).join('');
    else html += '<p class="empty">这里还没有内容。</p>';
    html += '</div></section>';
    view().innerHTML = html;
  }

  // ---------- 页面:分类页 ----------
  async function pageCategoryIndex() {
    const counts = await store.posts.counts();
    const countBy = id => counts.byCategory[id] || 0;

    let html = '<section class="block"><h2 class="block-title">分类</h2>';
    html += '<div class="author-list">';
    cfg.categories.forEach(c => {
      html += `<a class="author-card" href="#/category/${c.id}">
        <h3>${h(c.name)}</h3>
        <span class="count">${countBy(c.id)} 条</span>
      </a>`;
    });
    html += '</div></section>';
    view().innerHTML = html;
  }

  async function pageCategory(args) {
    const c = cfg.categoryById(args.id);
    if (!c) return view().innerHTML = '<p>没有这个分类。</p>';
    const data = await store.posts.listPublic({ category: c.id, pageSize: 1000 });
    const list = data.list || [];
    let html = `<section class="block">
      <p class="crumb"><a href="#/category">分类</a> / ${h(c.name)}</p>
      <h2 class="block-title">${h(c.name)}</h2>
      <p class="block-sub">共 ${list.length} 条</p>`;
    html += '<div class="cards">';
    if (list.length) html += list.map(postCard).join('');
    else html += '<p class="empty">这个分类下还没有内容。</p>';
    html += '</div></section>';
    view().innerHTML = html;
  }

  // ---------- 页面:标签页 ----------
  async function pageTag(args) {
    const tag = decodeURIComponent(args.name);
    const data = await store.posts.listPublic({ tag, pageSize: 1000 });
    const list = data.list || [];
    let html = `<section class="block">
      <p class="crumb"><a href="#/">首页</a> / 标签</p>
      <h2 class="block-title">#${h(tag)}</h2>
      <p class="block-sub">共 ${list.length} 条</p>`;
    html += '<div class="cards">';
    if (list.length) html += list.map(postCard).join('');
    else html += '<p class="empty">这个标签下还没有内容。</p>';
    html += '</div></section>';
    view().innerHTML = html;
  }

  // ---------- 页面:文章详情 ----------
  async function pagePost(args) {
    let p;
    try { p = await store.posts.byIdWithAlias(args.id); }
    catch (e) { return view().innerHTML = '<p class="empty">文章不存在或已隐藏。</p>'; }

    if (!p || p.draft || p.hidden) {
      return view().innerHTML = '<p class="empty">文章不存在或已隐藏。</p>';
    }
    const { prev, next } = await store.posts.neighbors(p.slug || p.id);
    const body = md.render(p.content || '', { fold: p.category !== 'long' });
    const tags = (p.tags || []).map(t => `<a href="#/tag/${encodeURIComponent(t)}" class="tag">#${h(t)}</a>`).join('');
    const imgs = (p.images || []).map(src => `<a href="${h(src)}" target="_blank" rel="noopener"><img src="${h(src)}" alt="" loading="lazy"></a>`).join('');

    const pid = p.slug || p.id;
    let html = '<article class="post">';
    html += `<div class="card-meta">
      <span class="meta-author">${h(authorName(p.author))}</span>
      <span class="meta-sep">·</span>
      <a class="meta-cat" href="#/category/${p.category}">${h(categoryName(p.category))}</a>
      ${p.pinned ? '<span class="pin">置顶</span>' : ''}
    </div>`;
    html += `<h1 class="post-title">${h(p.title || '(无题)')}</h1>`;
    html += `<div class="post-time">${fmtDate(p.createdAt)}${p.updatedAt && p.updatedAt !== p.createdAt ? ' · 更新于 ' + fmtDate(p.updatedAt) : ''}</div>`;
    html += `<div class="post-body">${body}</div>`;
    if (imgs) html += `<div class="post-gallery">${imgs}</div>`;
    if (tags) html += `<div class="post-tags">${tags}</div>`;
    html += '</article>';

    html += '<nav class="prev-next">';
    if (prev) html += `<a class="pn prev" href="#/post/${prev.slug || prev.id}"><span class="pn-label">上一篇</span><span class="pn-title">${h(prev.title || '(无题)')}</span></a>`;
    else html += '<span class="pn placeholder"></span>';
    if (next) html += `<a class="pn next" href="#/post/${next.slug || next.id}"><span class="pn-label">下一篇</span><span class="pn-title">${h(next.title || '(无题)')}</span></a>`;
    else html += '<span class="pn placeholder"></span>';
    html += '</nav>';

    view().innerHTML = html;
  }

  // ---------- 页面:关于 ----------
  function pageAbout() {
    let html = '<section class="block about">';
    html += '<h2 class="block-title">关于这里</h2>';
    html += `<div class="post-body"><p>这是一个<strong>私人的多作者记录站</strong>。</p>
      <p>它不是公开的社交平台,没有点赞、评论、关注、推送。</p>
      <p>我们只是把日常的碎碎念、偶尔的长文、照片、代码、歌单,以及一些想存档下来的东西,安静地留在这里。</p>
      <blockquote>留给自己看的,顺便分享给愿意看的人。</blockquote>
      <p>四位作者 / 来源:于加、江予朔、周叙、共同存档。</p>
      <p>如果你只是路过,安静地看看就好。</p></div>`;
    html += '</section>';
    view().innerHTML = html;
  }

  // ---------- 搜索 ----------
  async function pageSearch(args, params) {
    const q = params.q || '';
    let html = '<section class="block">';
    html += '<form class="search-form" onsubmit="return false">';
    html += `<input type="search" id="search-input" placeholder="搜索标题、正文、标签…" value="${h(q)}">`;
    html += '<button type="submit" id="search-btn">搜索</button>';
    html += '</form>';
    if (q) {
      const data = await store.posts.listPublic({ q, pageSize: 50 });
      const list = data.list || [];
      html += `<p class="block-sub">"${h(q)}" 的搜索结果 · ${list.length} 条</p>`;
      html += '<div class="cards">';
      if (list.length) html += list.map(postCard).join('');
      else html += '<p class="empty">没有找到。</p>';
      html += '</div>';
    }
    html += '</section>';
    view().innerHTML = html;
    const input = document.getElementById('search-input');
    const btn = document.getElementById('search-btn');
    const submit = () => router.go(`/search?q=${encodeURIComponent(input.value.trim())}`);
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  // ---------- 暴露 ----------
  window.DiaryView = {
    toast, fmtDate, fmtDateShort, authorName, categoryName, excerpt, h,
    postCard, pager,
    pageHome, pageList, pageAuthorIndex, pageAuthor,
    pageCategoryIndex, pageCategory, pageTag, pagePost, pageAbout, pageSearch
  };
})();
