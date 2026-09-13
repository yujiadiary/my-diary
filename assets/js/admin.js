// 后台:登录、发帖/编辑、管理列表、草稿、回收站、设置
// 只有路由命中 admin 时才会渲染;未登录则只显示登录页
// 全部页面函数都是 async
(function () {
  const cfg = window.DiaryConfig;
  const store = window.DiaryStore;
  const md = window.DiaryMD;
  const router = window.DiaryRouter;
  const V = window.DiaryView;
  const view = () => document.getElementById('view');

  async function requireLogin(then) {
    if (store.auth.isLoggedIn()) return then();
    renderLogin();
  }

  function adminShell(active, inner) {
    const tabs = [
      ['admin', '管理'],
      ['admin/new', '发帖'],
      ['admin/drafts', '草稿'],
      ['admin/trash', '回收站'],
      ['admin/settings', '设置']
    ];
    let nav = '<nav class="admin-tabs">';
    nav += tabs.map(t => `<a class="${active === t[0] ? 'active' : ''}" href="#/${t[0]}">${t[1]}</a>`).join('');
    nav += `<a class="admin-exit" href="#/">← 回前台</a>`;
    nav += '</nav>';
    return `<div class="admin">${nav}${inner}</div>`;
  }

  // ---------- 登录 ----------
  function renderLogin() {
    view().innerHTML = `<div class="admin-login">
      <h2>后台登录</h2>
      <p class="block-sub">这是私人后台,请输入密码。</p>
      <form id="login-form" class="admin-form">
        <label>密码<input type="password" id="login-pw" required></label>
        <button type="submit" class="btn primary">登录</button>
      </form>
      <p class="hint">密码由 Cloudflare 环境变量 ADMIN_PASSWORD 控制,联系部署者修改。</p>
    </div>`;
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const pw = document.getElementById('login-pw').value;
      try {
        await store.auth.login(pw);
        V.toast('登录成功');
        router.refresh();
      } catch (err) {
        V.toast('密码不对', 'error');
      }
    });
  }

  // ---------- 管理列表 ----------
  async function renderList() {
    await requireLogin(async () => {
      let data;
      try { data = await store.posts.listAll(); }
      catch (e) { V.toast('加载失败:' + e.message, 'error'); return; }
      const list = data.list || [];
      let draftsCount = 0, trashCount = 0;
      try {
        const d = await store.posts.listDrafts(); draftsCount = (d.list || []).length;
        const t = await store.posts.listTrash(); trashCount = (t.list || []).length;
      } catch (e) {}

      let rows = '';
      if (!list.length) rows = '<p class="empty">还没有内容,去"发帖"里写第一条吧。</p>';
      list.forEach(p => {
        const flags = [];
        if (p.pinned) flags.push('置顶');
        if (p.hidden) flags.push('隐藏');
        if (p.draft) flags.push('草稿');
        rows += `<tr class="${p.draft ? 'is-draft' : ''} ${p.hidden ? 'is-hidden' : ''}">
          <td class="col-title"><a href="#/post/${p.id}" target="_blank">${V.h(p.title || '(无题)')}</a>
            ${flags.length ? '<span class="row-flags">' + flags.map(f => `<i>${f}</i>`).join('') + '</span>' : ''}
          </td>
          <td>${V.h(V.authorName(p.author))}</td>
          <td>${V.h(V.categoryName(p.category))}</td>
          <td class="col-time">${V.fmtDateShort(p.createdAt)}</td>
          <td class="col-actions">
            <a href="#/admin/edit/${p.id}">编辑</a>
            <button data-act="pin" data-id="${p.id}">${p.pinned ? '取消置顶' : '置顶'}</button>
            <button data-act="hide" data-id="${p.id}">${p.hidden ? '显示' : '隐藏'}</button>
            <button data-act="del" data-id="${p.id}" class="danger">删除</button>
          </td>
        </tr>`;
      });
      const inner = `
        <div class="admin-stats">
          <span>已发布 ${list.filter(p => !p.draft).length}</span>
          <a href="#/admin/drafts">草稿 ${draftsCount}</a>
          <a href="#/admin/trash">回收站 ${trashCount}</a>
        </div>
        <div class="table-wrap"><table class="admin-table">
          <thead><tr><th>标题</th><th>作者</th><th>分类</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
      view().innerHTML = adminShell('admin', inner);
      bindRowActions();
    });
  }

  function bindRowActions() {
    view().querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        try {
          if (act === 'pin') { await store.posts.togglePin(id); V.toast('已更新'); await renderList(); }
          else if (act === 'hide') { await store.posts.toggleHide(id); V.toast('已更新'); await renderList(); }
          else if (act === 'del') {
            if (confirm('移到回收站?稍后可恢复。')) { await store.posts.softDelete(id); V.toast('已移入回收站'); await renderList(); }
          }
        } catch (e) { V.toast('操作失败:' + e.message, 'error'); }
      });
    });
  }

  // ---------- 草稿 ----------
  async function renderDrafts() {
    await requireLogin(async () => {
      let list = [];
      try { const d = await store.posts.listDrafts(); list = d.list || []; }
      catch (e) { V.toast('加载失败', 'error'); }
      const rows = list.length ? list.map(p => draftRow(p)).join('') : '<p class="empty">没有草稿。</p>';
      view().innerHTML = adminShell('admin/drafts', `<div class="admin-stats"><span>草稿 ${list.length} 条</span></div>${rows}`);
      bindDraftActions();
    });
  }
  function draftRow(p) {
    return `<div class="draft-row">
      <div><a href="#/admin/edit/${p.id}">${V.h(p.title || '(无题)')}</a>
      <span class="row-flags"><i>草稿</i></span></div>
      <div class="draft-time">${V.fmtDateShort(p.updatedAt || p.createdAt)}</div>
      <div class="col-actions">
        <a href="#/admin/edit/${p.id}">继续编辑</a>
        <button data-act="publish" data-id="${p.id}" class="primary">发布</button>
        <button data-act="del" data-id="${p.id}" class="danger">删除</button>
      </div>
    </div>`;
  }
  function bindDraftActions() {
    view().querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          if (btn.dataset.act === 'publish') {
            await store.posts.update(id, { draft: false });
            V.toast('已发布'); await renderDrafts();
          } else if (btn.dataset.act === 'del') {
            if (confirm('移到回收站?')) { await store.posts.softDelete(id); V.toast('已移入回收站'); await renderDrafts(); }
          }
        } catch (e) { V.toast('操作失败:' + e.message, 'error'); }
      });
    });
  }

  // ---------- 回收站 ----------
  async function renderTrash() {
    await requireLogin(async () => {
      let list = [];
      try { const d = await store.posts.listTrash(); list = d.list || []; }
      catch (e) {}
      const rows = list.length ? list.map(p => `<div class="draft-row">
        <div>${V.h(p.title || '(无题)')}</div>
        <div class="draft-time">${V.fmtDateShort(p.deletedAt)}</div>
        <div class="col-actions">
          <button data-act="restore" data-id="${p.id}" class="primary">恢复</button>
          <button data-act="purge" data-id="${p.id}" class="danger">彻底删除</button>
        </div>
      </div>`).join('') : '<p class="empty">回收站是空的。</p>';
      const extra = list.length ? '<button id="empty-trash" class="danger">清空回收站</button>' : '';
      view().innerHTML = adminShell('admin/trash', `<div class="admin-stats"><span>回收站 ${list.length} 条</span>${extra}</div>${rows}`);
      view().querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          try {
            if (btn.dataset.act === 'restore') { await store.posts.restore(id); V.toast('已恢复'); await renderTrash(); }
            else if (btn.dataset.act === 'purge') {
              if (confirm('彻底删除后无法恢复,确定?')) { await store.posts.permanentDelete(id); V.toast('已删除'); await renderTrash(); }
            }
          } catch (e) { V.toast('操作失败:' + e.message, 'error'); }
        });
      });
      const et = document.getElementById('empty-trash');
      if (et) et.addEventListener('click', async () => {
        if (confirm('清空全部回收站内容?此操作不可恢复。')) {
          try { await store.posts.emptyTrash(); V.toast('已清空'); await renderTrash(); }
          catch (e) { V.toast('操作失败:' + e.message, 'error'); }
        }
      });
    });
  }

  // ---------- 发帖 / 编辑 ----------
  async function renderEditor(args) {
    await requireLogin(async () => {
      let editing = null;
      if (args && args.id) {
        try { editing = await store.posts.byId(args.id); }
        catch (e) { V.toast('加载失败', 'error'); }
      }
      const p = editing || { author: cfg.authors[0].id, category: cfg.categories[0].id, tags: [], images: [], pinned: false, hidden: false, draft: false };
      const isEdit = !!editing;

      let authorOpts = cfg.authors.map(a => `<option value="${a.id}" ${a.id === p.author ? 'selected' : ''}>${V.h(a.name)}</option>`).join('');
      let catOpts = cfg.categories.map(c => `<option value="${c.id}" ${c.id === p.category ? 'selected' : ''}>${V.h(c.name)}</option>`).join('');

      view().innerHTML = adminShell(isEdit ? '' : 'admin/new', `
        <h2 class="block-title">${isEdit ? '编辑' : '写新内容'}</h2>
        <form id="editor-form" class="admin-form">
          <label>标题<input type="text" name="title" value="${V.h(p.title || '')}" placeholder="给这条内容起个名字"></label>
          <div class="form-row">
            <label>作者<select name="author">${authorOpts}</select></label>
            <label>分类<select name="category">${catOpts}</select></label>
          </div>
          <label>标签 <small>(逗号分隔)</small><input type="text" name="tags" value="${V.h((p.tags || []).join(', '))}" placeholder="日常, 心情"></label>
          <label>正文 <small>(支持换行、&gt; 引用、\`\`\`代码块\`\`\`、图片链接)</small>
            <textarea name="content" rows="14" placeholder="写点什么…">${V.h(p.content || '')}</textarea>
          </label>
          <label>图片链接 <small>(每行一个外链,或点下方按钮本地上传,base64 形式存)</small>
            <textarea name="images" rows="3" placeholder="https://…">${V.h((p.images || []).join('\n'))}</textarea>
          </label>
          <div class="upload-row">
            <input type="file" id="img-file" accept="image/*" multiple>
            <span class="hint">本地上传的图片以 base64 存入数据库,体积大,只建议小图。</span>
          </div>
          <div class="form-checks">
            <label class="check"><input type="checkbox" name="pinned" ${p.pinned ? 'checked' : ''}> 置顶</label>
            <label class="check"><input type="checkbox" name="hidden" ${p.hidden ? 'checked' : ''}> 隐藏(前台不显示)</label>
            <label class="check"><input type="checkbox" name="draft" ${p.draft ? 'checked' : ''}> 存为草稿</label>
          </div>
          <div class="form-actions">
            <button type="submit" name="save" class="btn primary">${isEdit ? '保存修改' : '发布'}</button>
            <button type="submit" name="saveDraft" class="btn">存为草稿</button>
            ${isEdit ? `<a class="btn" href="#/admin">取消</a>` : ''}
          </div>
        </form>
      `);

      const form = document.getElementById('editor-form');
      const fileInput = document.getElementById('img-file');

      fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        if (!files.length) return;
        const ta = form.elements.images;
        Promise.all(files.map(file => new Promise(res => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.readAsDataURL(file);
        }))).then(urls => {
          const cur = ta.value.trim();
          ta.value = (cur ? cur + '\n' : '') + urls.join('\n');
          V.toast(`已添加 ${urls.length} 张图片(base64)`);
        });
      });

      form.addEventListener('submit', async e => {
        const submitter = e.submitter;
        const asDraft = submitter && submitter.name === 'saveDraft';
        if (e.target !== form) return;
        e.preventDefault();
        const fd = new FormData(form);
        const data = {
          title: fd.get('title'),
          content: fd.get('content'),
          author: fd.get('author'),
          category: fd.get('category'),
          tags: String(fd.get('tags') || ''),
          images: String(fd.get('images') || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean),
          pinned: fd.get('pinned') === 'on',
          hidden: fd.get('hidden') === 'on',
          draft: asDraft ? true : fd.get('draft') === 'on'
        };
        try {
          if (isEdit) {
            await store.posts.update(p.id, data);
            V.toast('已保存');
          } else {
            await store.posts.create(data);
            V.toast(asDraft ? '草稿已保存' : '已发布');
          }
          router.go('/admin');
        } catch (err) {
          V.toast('保存失败:' + err.message, 'error');
        }
      });
    });
  }

  // ---------- 设置 ----------
  function renderSettings() {
    requireLogin(() => {
      view().innerHTML = adminShell('admin/settings', `
        <h2 class="block-title">设置</h2>
        <div class="admin-form">
          <h3>关于密码</h3>
          <p class="hint">密码由 Cloudflare 环境变量 <code>ADMIN_PASSWORD</code> 控制。要修改,登录 Cloudflare 控制台 → 你的 Pages 项目 → Settings → Environment Variables,改完后重新部署一次生效。</p>

          <h3>数据备份</h3>
          <p class="hint">数据现在存在 Cloudflare D1 数据库,跨设备同步。仍建议定期导出 JSON 留底。</p>
          <div class="form-actions">
            <button id="export-btn" class="btn primary">导出全部数据 (JSON)</button>
          </div>

          <h3>初始化示例数据</h3>
          <p class="hint">如果数据库是空的,可以一键插入示例文章。</p>
          <button id="seed-btn" class="btn">插入示例数据</button>

          <h3>其它</h3>
          <button id="logout-btn" class="btn">退出登录</button>
        </div>`);

      document.getElementById('export-btn').addEventListener('click', async () => {
        try { await store.downloadExportJSON(); V.toast('已开始下载备份文件'); }
        catch (e) { V.toast('导出失败:' + e.message, 'error'); }
      });
      document.getElementById('seed-btn').addEventListener('click', async () => {
        try {
          await store.posts.seedIfEmpty();
          V.toast('已处理(若已存在数据则不会重复插入)');
          router.refresh();
        } catch (e) { V.toast('失败:' + e.message, 'error'); }
      });
      document.getElementById('logout-btn').addEventListener('click', () => {
        store.auth.logout();
        V.toast('已退出');
        router.go('/');
      });
    });
  }

  // 暴露路由处理函数
  window.DiaryAdmin = {
    login: renderLogin,
    list: renderList,
    drafts: renderDrafts,
    trash: renderTrash,
    editor: renderEditor,
    settings: renderSettings
  };
})();
