// 后台:登录、发帖/编辑、管理列表、草稿、回收站、设置、导入导出
// 只有路由命中 admin 时才会渲染;未登录则只显示登录页
(function () {
  const cfg = window.DiaryConfig;
  const store = window.DiaryStore;
  const md = window.DiaryMD;
  const router = window.DiaryRouter;
  const V = window.DiaryView;
  const view = () => document.getElementById('view');

  function requireLogin(then) {
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
      <p class="hint">默认密码见 config.js,首次进入后台请尽快在"设置"里修改。</p>
    </div>`;
    document.getElementById('login-form').addEventListener('submit', e => {
      e.preventDefault();
      const pw = document.getElementById('login-pw').value;
      if (store.auth.login(pw)) {
        V.toast('登录成功');
        router.refresh();
      } else {
        V.toast('密码不对', 'error');
      }
    });
  }

  // ---------- 管理列表 ----------
  function renderList() {
    requireLogin(() => {
      const list = store.posts.listAll();
      const drafts = store.posts.listDrafts().length;
      const trash = store.posts.listTrash().length;
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
          <a href="#/admin/drafts">草稿 ${drafts}</a>
          <a href="#/admin/trash">回收站 ${trash}</a>
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
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        if (act === 'pin') { store.posts.togglePin(id); V.toast('已更新'); renderList(); }
        else if (act === 'hide') { store.posts.toggleHide(id); V.toast('已更新'); renderList(); }
        else if (act === 'del') {
          if (confirm('移到回收站?稍后可恢复。')) { store.posts.softDelete(id); V.toast('已移入回收站'); renderList(); }
        }
      });
    });
  }

  // ---------- 草稿 ----------
  function renderDrafts() {
    requireLogin(() => {
      const list = store.posts.listDrafts();
      const rows = list.length ? list.map(p => draftRow(p)).join('') : '<p class="empty">没有草稿。</p>';
      view().innerHTML = adminShell('admin/drafts', `<div class="admin-stats"><span>草稿 ${list.length} 条</span></div>${rows}`);
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

  // ---------- 回收站 ----------
  function renderTrash() {
    requireLogin(() => {
      const list = store.posts.listTrash();
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
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          if (btn.dataset.act === 'restore') { store.posts.restore(id); V.toast('已恢复'); renderTrash(); }
          else if (btn.dataset.act === 'purge') {
            if (confirm('彻底删除后无法恢复,确定?')) { store.posts.permanentDelete(id); V.toast('已删除'); renderTrash(); }
          }
        });
      });
      const et = document.getElementById('empty-trash');
      if (et) et.addEventListener('click', () => {
        if (confirm('清空全部回收站内容?此操作不可恢复。')) { store.posts.emptyTrash(); V.toast('已清空'); renderTrash(); }
      });
    });
  }

  // ---------- 发帖 / 编辑 ----------
  function renderEditor(args) {
    requireLogin(() => {
      const editing = args && args.id ? store.posts.byId(args.id) : null;
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
          <label>图片链接 <small>(每行一个外链,或点下方按钮本地上传)</small>
            <textarea name="images" rows="3" placeholder="https://…">${V.h((p.images || []).join('\n'))}</textarea>
          </label>
          <div class="upload-row">
            <input type="file" id="img-file" accept="image/*" multiple>
            <span class="hint">本地上传的图片以 base64 存在数据里,体积大,仅建议小图。</span>
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

      // 本地上传 -> 转 base64 追加到 images textarea
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

      form.addEventListener('submit', e => {
        // 用 submitter 判断按钮
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
        if (isEdit) {
          store.posts.update(p.id, data);
          V.toast('已保存');
        } else {
          const np = store.posts.create(data);
          V.toast(asDraft ? '草稿已保存' : '已发布');
        }
        router.go('/admin');
      });
    });
  }

  // ---------- 设置 ----------
  function renderSettings() {
    requireLogin(() => {
      view().innerHTML = adminShell('admin/settings', `
        <h2 class="block-title">设置</h2>
        <div class="admin-form">
          <h3>修改密码</h3>
          <form id="pw-form">
            <label>当前密码<input type="password" id="pw-old" required></label>
            <label>新密码 <small>(至少 4 位)</small><input type="password" id="pw-new" required></label>
            <button type="submit" class="btn primary">保存密码</button>
          </form>

          <h3>数据备份</h3>
          <p class="hint">数据保存在浏览器 localStorage,建议定期导出备份。换浏览器/清缓存会丢失。</p>
          <div class="form-actions">
            <button id="export-btn" class="btn primary">导出全部数据 (JSON)</button>
          </div>

          <h3>导入数据</h3>
          <form id="import-form">
            <input type="file" id="import-file" accept="application/json" required>
            <label class="check"><input type="radio" name="mode" value="merge" checked> 合并(已有的跳过)</label>
            <label class="check"><input type="radio" name="mode" value="replace"> 整体替换(会覆盖当前数据)</label>
            <button type="submit" class="btn">导入</button>
          </form>
          <p class="hint danger-text">"整体替换"会清空当前内容,谨慎使用。</p>

          <h3>其它</h3>
          <button id="logout-btn" class="btn">退出登录</button>
      </div>`);
      document.getElementById('pw-form').addEventListener('submit', e => {
        e.preventDefault();
        const ok = store.auth.changePassword(document.getElementById('pw-old').value, document.getElementById('pw-new').value);
        V.toast(ok ? '密码已修改' : '当前密码不对或新密码太短', ok ? '' : 'error');
        if (ok) e.target.reset();
      });
      document.getElementById('export-btn').addEventListener('click', () => {
        store.data.exportJSON();
        V.toast('已开始下载备份文件');
      });
      document.getElementById('import-form').addEventListener('submit', e => {
        e.preventDefault();
        const file = document.getElementById('import-file').files[0];
        if (!file) return;
        const mode = document.querySelector('input[name=mode]:checked').value;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const json = JSON.parse(reader.result);
            const n = store.data.importJSON(json, mode);
            V.toast(`已导入 ${n} 条`);
          } catch (err) {
            V.toast('导入失败:' + err.message, 'error');
          }
        };
        reader.readAsText(file);
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
