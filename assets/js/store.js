// 数据层:通过 fetch 调 Cloudflare Pages Functions + D1
// 所有方法都是 async,前端调用方需要 await
(function () {
  const cfg = window.DiaryConfig;
  const api = cfg.apiBase;

  // ---------- fetch 封装 ----------
  async function request(path, options) {
    options = options || {};
    const headers = Object.assign({}, options.headers || {});
    if (options.body && typeof options.body !== 'string') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const token = localStorage.getItem(cfg.tokenKey);
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let res;
    try {
      res = await fetch(api + path, Object.assign({}, options, { headers }));
    } catch (e) {
      throw new Error('网络错误:无法连接服务器');
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try { data = await res.json(); } catch (e) { data = null; }
    }
    if (!res.ok) {
      const msg = (data && data.error) || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function setToken(token) {
    if (token) localStorage.setItem(cfg.tokenKey, token);
    else localStorage.removeItem(cfg.tokenKey);
  }

  // ---------- 鉴权 ----------
  const auth = {
    async login(password) {
      const data = await request('/login', { method: 'POST', body: { password } });
      setToken(data.token);
      return data;
    },
    isLoggedIn() {
      return !!localStorage.getItem(cfg.tokenKey);
    },
    logout() {
      localStorage.removeItem(cfg.tokenKey);
    }
  };

  // ---------- 帖子 ----------
  const posts = {
    // 前台用:listMode 缺省=public(只看已发布未隐藏未删)
    async listPublic(filter) {
      const q = new URLSearchParams();
      if (filter) {
        if (filter.author) q.set('author', filter.author);
        if (filter.category) q.set('category', filter.category);
        if (filter.tag) q.set('tag', filter.tag);
        if (filter.q) q.set('q', filter.q);
        if (filter.page) q.set('page', filter.page);
        if (filter.pageSize) q.set('pageSize', filter.pageSize);
      }
      const data = await request('/posts?' + q.toString());
      return data;
    },

    // 后台用
    async listAll() { return request('/posts?listMode=all'); },
    async listDrafts() { return request('/posts?listMode=drafts'); },
    async listTrash() { return request('/posts?listMode=trash'); },

    async byId(id) {
      const data = await request('/posts/' + encodeURIComponent(id));
      return data.post;
    },

    async create(data) {
      const r = await request('/posts', { method: 'POST', body: data });
      return r.post;
    },
    async update(id, data) {
      const r = await request('/posts/' + encodeURIComponent(id), { method: 'PUT', body: data });
      return r.post;
    },
    async togglePin(id) {
      const r = await request('/posts/' + encodeURIComponent(id) + '/pin', { method: 'POST' });
      return r;
    },
    async toggleHide(id) {
      const r = await request('/posts/' + encodeURIComponent(id) + '/hide', { method: 'POST' });
      return r;
    },
    async softDelete(id) {
      return request('/posts/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    async restore(id) {
      return request('/posts/' + encodeURIComponent(id) + '/restore', { method: 'POST' });
    },
    async permanentDelete(id) {
      return request('/posts/' + encodeURIComponent(id) + '/permanent', { method: 'DELETE' });
    },
    async emptyTrash() {
      return request('/posts/empty-trash', { method: 'POST' });
    },
    async seedIfEmpty() {
      // 调种子接口(已存在数据则不插)
      try { return await request('/posts/seed', { method: 'POST' }); }
      catch (e) { return null; }
    },

    // 上一篇/下一篇:从前台列表里找
    async neighbors(id, filter) {
      const data = await this.listPublic(filter);
      const list = data.list || [];
      const i = list.findIndex(p => p.id === id);
      if (i < 0) return { prev: null, next: null };
      return {
        prev: i + 1 < list.length ? list[i + 1] : null,
        next: i - 1 >= 0 ? list[i - 1] : null
      };
    },

    async exportAll() {
      // 后台导出走 API;前台下载
      return request('/export');
    }
  };

  function parseTags(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    return String(input).split(/[,，]/).map(t => t.trim()).filter(Boolean);
  }

  // 下载导出 JSON(后台用)
  async function downloadExportJSON() {
    const data = await posts.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diary-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.DiaryStore = { auth, posts, parseTags, downloadExportJSON, request };
})();
