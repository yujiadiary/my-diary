// "后台"页:内容现在通过 PagesCMS + git 管理,网站本身没有登录态
// 这里只是一个引导页,告诉你去哪发帖、怎么管理
(function () {
  const cfg = window.DiaryConfig;
  const store = window.DiaryStore;
  const V = window.DiaryView;
  const view = () => document.getElementById('view');

  // GitHub 仓库地址(从 cfg 推不出来,硬编码;改仓库名改这里)
  const REPO = 'yujiadiary/my-diary';
  const GITHUB_URL = `https://github.com/${REPO}`;
  const PAGESCMS_URL = 'https://pagescms.org';

  function adminShell(active, inner) {
    const tabs = [
      ['admin', '管理'],
      ['admin/guide', '发帖指引'],
      ['admin/fields', '字段说明'],
      ['admin/settings', '设置']
    ];
    let nav = '<nav class="admin-tabs">';
    nav += tabs.map(t => `<a class="${active === t[0] ? 'active' : ''}" href="#/${t[0]}">${t[1]}</a>`).join('');
    nav += `<a class="admin-exit" href="#/">← 回前台</a>`;
    nav += '</nav>';
    return `<div class="admin">${nav}${inner}</div>`;
  }

  // ---------- 管理:列出当前所有 Markdown 文件 ----------
  async function renderList() {
    let list = [];
    let total = 0;
    try {
      // 这里调 listPublic 但 pageSize 设很大,把全部(包括隐藏/草稿)显示
      // 不过 listPublic 只返回 visible;要全部得直接拿 index
      const data = await store.getIndex();
      list = (data.posts || []).slice();
      total = list.length;
    } catch (e) {
      view().innerHTML = adminShell('admin', `<p class="empty">加载失败:${V.h(e.message)}</p>`);
      return;
    }
    // 按 createdAt 倒序
    list.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    let rows = '';
    if (!list.length) rows = '<p class="empty">还没有任何内容。去 PagesCMS 写第一条吧。</p>';
    list.forEach(p => {
      const flags = [];
      if (p.pinned) flags.push('置顶');
      if (p.hidden) flags.push('隐藏');
      if (p.draft) flags.push('草稿');
      rows += `<tr class="${p.draft ? 'is-draft' : ''} ${p.hidden ? 'is-hidden' : ''}">
        <td class="col-title">
          <a href="${GITHUB_URL}/blob/main/posts/${encodeURIComponent(p.slug)}.md" target="_blank" rel="noopener">${V.h(p.title || '(无题)')}</a>
          ${flags.length ? '<span class="row-flags">' + flags.map(f => `<i>${f}</i>`).join('') + '</span>' : ''}
          <small class="row-slug">posts/${V.h(p.slug)}.md</small>
        </td>
        <td>${V.h(V.authorName(p.author))}</td>
        <td>${V.h(V.categoryName(p.category))}</td>
        <td class="col-time">${V.fmtDateShort(p.createdAt)}</td>
      </tr>`;
    });
    const inner = `
      <div class="admin-stats">
        <span>共 ${total} 条</span>
        <a href="${PAGESCMS_URL}" target="_blank" rel="noopener" class="btn primary">前往 PagesCMS 发帖 →</a>
      </div>
      <p class="hint">这是只读视图,所有编辑在 PagesCMS(或直接在 GitHub 网页编辑 Markdown 文件)完成。修改提交后,Cloudflare Pages 会自动重新构建,前台随之更新。</p>
      <div class="table-wrap"><table class="admin-table">
        <thead><tr><th>标题(点开看源文件)</th><th>作者</th><th>分类</th><th>时间</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    view().innerHTML = adminShell('admin', inner);
  }

  // ---------- 发帖指引 ----------
  function renderGuide() {
    const inner = `
      <h2 class="block-title">怎么发帖</h2>
      <div class="post-body">
        <h3>方式 1:PagesCMS(推荐,手机/电脑都能用)</h3>
        <ol>
          <li>打开 <a href="${PAGESCMS_URL}" target="_blank" rel="noopener">pagescms.org</a></li>
          <li>点 <strong>Add site</strong>,选 GitHub,授权后选仓库 <code>${REPO}</code></li>
          <li>它会自动读取 <code>.pages.config.yml</code> 配置,识别出"文章"集合和字段</li>
          <li>点 <strong>Posts</strong> → <strong>New</strong>,填表,保存</li>
          <li>PagesCMS 会把你的内容作为 Markdown 文件提交到 <code>posts/</code> 目录</li>
          <li>Cloudflare Pages 检测到推送 → 自动跑 <code>node build.js</code> → 重新生成 <code>posts/index.json</code> → 前台刷新就能看到</li>
        </ol>

        <h3>方式 2:直接改 GitHub 网页</h3>
        <ol>
          <li>去 <a href="${GITHUB_URL}/tree/main/posts" target="_blank" rel="noopener">仓库的 posts 目录</a></li>
          <li>点 <strong>Add file → Create new file</strong></li>
          <li>文件名用 <code>YYYY-MM-DD-作者-标题关键词.md</code> 格式(可中英混排)</li>
          <li>文件内容见下面「字段说明」页</li>
          <li>提交后同样会自动触发构建</li>
        </ol>

        <h3>方式 3:本地 git</h3>
        <ol>
          <li><code>git clone ${GITHUB_URL}.git</code></li>
          <li>在 <code>posts/</code> 下新建 .md 文件,格式见「字段说明」</li>
          <li><code>git add . && git commit -m "new post" && git push</code></li>
        </ol>
      </div>`;
    view().innerHTML = adminShell('admin/guide', inner);
  }

  // ---------- 字段说明 ----------
  function renderFields() {
    const authorList = cfg.authors.map(a => `<code>${a.id}</code>(${V.h(a.name)})`).join(' · ');
    const catList = cfg.categories.map(c => `<code>${c.id}</code>(${V.h(c.name)})`).join(' · ');
    const inner = `
      <h2 class="block-title">Markdown 文件格式</h2>
      <p class="block-sub">每个 .md 文件由 frontmatter(元数据)+ 正文 两部分组成。示例如下:</p>
      <pre class="code-block">---
title: 标题
author: jiang
category: daily
tags: [日常, 心情]
images: []
pinned: false
hidden: false
draft: false
createdAt: 2026-09-13
updatedAt: 2026-09-14
---

这里是正文。支持换行、&gt; 引用、\`\`\`代码块\`\`\`。

&gt; 这是一段引用。

\`\`\`
// 代码块
console.log('hi');
\`\`\`</pre>
      <h3>字段说明</h3>
      <table class="admin-table">
        <thead><tr><th>字段</th><th>必填</th><th>说明</th></tr></thead>
        <tbody>
          <tr><td><code>title</code></td><td>是</td><td>标题,字符串</td></tr>
          <tr><td><code>author</code></td><td>是</td><td>作者 id。可选值:${authorList}</td></tr>
          <tr><td><code>category</code></td><td>是</td><td>分类 id。可选值:${catList}</td></tr>
          <tr><td><code>tags</code></td><td>否</td><td>标签数组。<code>[a, b]</code> 或 <code>a, b</code> 都行</td></tr>
          <tr><td><code>images</code></td><td>否</td><td>图片外链数组,前台会作为画廊显示</td></tr>
          <tr><td><code>pinned</code></td><td>否</td><td>true/false,置顶(排在所有列表最前)</td></tr>
          <tr><td><code>hidden</code></td><td>否</td><td>true/false,隐藏(前台不显示)</td></tr>
          <tr><td><code>draft</code></td><td>否</td><td>true/false,草稿(前台不显示)</td></tr>
          <tr><td><code>createdAt</code></td><td>否</td><td>创建时间,YYYY-MM-DD(可带时分秒)</td></tr>
          <tr><td><code>updatedAt</code></td><td>否</td><td>更新时间,同上</td></tr>
        </tbody>
      </table>
      <h3>文件名约定</h3>
      <p class="hint">建议 <code>YYYY-MM-DD-{作者}-{关键词}.md</code>,例如 <code>2026-09-13-jiang-碎碎念的第一篇.md</code>。文件名会作为文章的唯一 id(slug),改了等于换了一篇。</p>
      <h3>图片</h3>
      <p class="hint">图片用外链(图床 / GitHub raw / R2 公共 URL)写入 <code>images</code>。本站不带本地上传能力(纯静态),如果你需要本地上传,把图片拖到 GitHub 仓库的 <code>assets/uploads/</code> 目录,引用时用相对路径 <code>/my-diary/assets/uploads/xxx.jpg</code>。</p>`;
    view().innerHTML = adminShell('admin/fields', inner);
  }

  // ---------- 设置 ----------
  function renderSettings() {
    const inner = `
      <h2 class="block-title">设置</h2>
      <div class="admin-form">
        <h3>关于"登录"</h3>
        <p class="hint">当前架构下,网站本身没有登录态。内容管理走 PagesCMS(它有自己的 GitHub 授权),所以网页后台不再需要密码。</p>

        <h3>数据备份</h3>
        <p class="hint">数据现在已经全部存在 git 仓库的 <code>posts/</code> 目录里。git 本身就是版本控制和备份。如果想导出一份 JSON 留底,点下面按钮:</p>
        <div class="form-actions">
          <button id="export-btn" class="btn primary">导出当前数据 (JSON)</button>
        </div>

        <h3>构建状态</h3>
        <p class="hint">每次提交后,Cloudflare Pages 会自动跑 <code>node build.js</code> 重新生成索引。如果看不到新文章,先去 Cloudflare 控制台确认这次构建有没有成功。</p>

        <h3>仓库链接</h3>
        <p><a href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_URL}</a></p>
      </div>`;
    view().innerHTML = adminShell('admin/settings', inner);
    document.getElementById('export-btn').addEventListener('click', async () => {
      try { await store.downloadExportJSON(); V.toast('已开始下载备份'); }
      catch (e) { V.toast('导出失败:' + e.message, 'error'); }
    });
  }

  window.DiaryAdmin = {
    list: renderList,
    guide: renderGuide,
    fields: renderFields,
    settings: renderSettings
  };
})();
