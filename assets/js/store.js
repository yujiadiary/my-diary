// 数据层:基于 localStorage 的简单持久化
// 所有帖子的 CRUD、回收站、登录态、导出导入都在这里
// 结构上分为 settings(设置)、posts(帖子列表)、session(登录态)
(function () {
  const KEY_POSTS = 'diary.posts';
  const KEY_SETTINGS = 'diary.settings';
  const SESSION_KEY = 'diary.session';

  // ---------- 通用工具 ----------
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('读取失败', key, e);
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('写入失败', key, e);
      return false;
    }
  }
  function uid() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  function now() {
    return new Date().toISOString();
  }

  // ---------- 设置 ----------
  const settings = {
    get(key, fallback) {
      const all = read(KEY_SETTINGS, {});
      if (key in all) return all[key];
      // 默认密码兜底
      if (key === 'adminPassword') return window.DiaryConfig.defaultAdminPassword;
      return fallback;
    },
    set(key, value) {
      const all = read(KEY_SETTINGS, {});
      all[key] = value;
      write(KEY_SETTINGS, all);
    },
    all() {
      return Object.assign({ adminPassword: window.DiaryConfig.defaultAdminPassword }, read(KEY_SETTINGS, {}));
    }
  };

  // ---------- 登录态 ----------
  // 用 sessionStorage,关掉浏览器就退出登录,降低泄露风险
  const auth = {
    login(password) {
      const ok = password && password === settings.get('adminPassword');
      if (ok) sessionStorage.setItem(SESSION_KEY, '1');
      return ok;
    },
    isLoggedIn() {
      return sessionStorage.getItem(SESSION_KEY) === '1';
    },
    logout() {
      sessionStorage.removeItem(SESSION_KEY);
    },
    changePassword(oldP, newP) {
      if (oldP !== settings.get('adminPassword')) return false;
      if (!newP || newP.length < 4) return false;
      settings.set('adminPassword', newP);
      return true;
    }
  };

  // ---------- 帖子 CRUD ----------
  const posts = {
    _readAll() {
      return read(KEY_POSTS, []);
    },
    _writeAll(list) {
      return write(KEY_POSTS, list);
    },

    // 后台用:包含草稿、回收站、隐藏
    listAll() {
      return this._readAll()
        .filter(p => !p.deletedAt)
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    },
    listDrafts() {
      return this._readAll().filter(p => p.draft && !p.deletedAt);
    },
    listTrash() {
      return this._readAll().filter(p => p.deletedAt);
    },

    // 前台用:只返回已发布、未隐藏、未删除
    listPublic(filter) {
      let list = this._readAll().filter(p => !p.draft && !p.hidden && !p.deletedAt);
      if (filter) {
        if (filter.author) list = list.filter(p => p.author === filter.author);
        if (filter.category) list = list.filter(p => p.category === filter.category);
        if (filter.tag) list = list.filter(p => (p.tags || []).map(t => t.toLowerCase()).includes(String(filter.tag).toLowerCase()));
        if (filter.q) {
          const q = filter.q.toLowerCase();
          list = list.filter(p =>
            (p.title || '').toLowerCase().includes(q) ||
            (p.content || '').toLowerCase().includes(q) ||
            (p.tags || []).some(t => t.toLowerCase().includes(q))
          );
        }
      }
      // 置顶优先,然后按时间倒序
      list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || '').localeCompare(a.createdAt || ''));
      return list;
    },

    byId(id) {
      return this._readAll().find(p => p.id === id) || null;
    },

    create(data) {
      const post = {
        id: uid(),
        title: (data.title || '').trim(),
        content: data.content || '',
        author: data.author || '',
        category: data.category || '',
        tags: Array.isArray(data.tags) ? data.tags : parseTags(data.tags),
        images: data.images || [],
        pinned: !!data.pinned,
        hidden: !!data.hidden,
        draft: !!data.draft,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now()
      };
      const list = this._readAll();
      list.push(post);
      this._writeAll(list);
      return post;
    },

    update(id, data) {
      const list = this._readAll();
      const i = list.findIndex(p => p.id === id);
      if (i < 0) return null;
      const old = list[i];
      const next = Object.assign({}, old, {
        title: (data.title ?? old.title).trim(),
        content: data.content ?? old.content,
        author: data.author ?? old.author,
        category: data.category ?? old.category,
        tags: Array.isArray(data.tags) ? data.tags : parseTags(data.tags),
        images: data.images ?? old.images,
        pinned: !!data.pinned,
        hidden: !!data.hidden,
        draft: !!data.draft,
        updatedAt: now()
      });
      list[i] = next;
      this._writeAll(list);
      return next;
    },

    togglePin(id) {
      const list = this._readAll();
      const i = list.findIndex(p => p.id === id);
      if (i < 0) return null;
      list[i].pinned = !list[i].pinned;
      list[i].updatedAt = now();
      this._writeAll(list);
      return list[i];
    },

    toggleHide(id) {
      const list = this._readAll();
      const i = list.findIndex(p => p.id === id);
      if (i < 0) return null;
      list[i].hidden = !list[i].hidden;
      list[i].updatedAt = now();
      this._writeAll(list);
      return list[i];
    },

    // 软删除 -> 回收站
    softDelete(id) {
      const list = this._readAll();
      const i = list.findIndex(p => p.id === id);
      if (i < 0) return null;
      list[i].deletedAt = now();
      list[i].pinned = false; // 删除时取消置顶
      this._writeAll(list);
      return list[i];
    },

    restore(id) {
      const list = this._readAll();
      const i = list.findIndex(p => p.id === id);
      if (i < 0) return null;
      list[i].deletedAt = null;
      this._writeAll(list);
      return list[i];
    },

    permanentDelete(id) {
      const list = this._readAll().filter(p => p.id !== id);
      this._writeAll(list);
    },

    emptyTrash() {
      const kept = this._readAll().filter(p => !p.deletedAt);
      this._writeAll(kept);
    },

    // 前一篇/后一篇(同一筛选条件下按时间排序)
    neighbors(id) {
      const list = this.listPublic();
      const i = list.findIndex(p => p.id === id);
      if (i < 0) return { prev: null, next: null };
      // 列表是倒序(最新在前),所以"上一篇"是后一项,"下一篇"是前一项
      return {
        prev: i + 1 < list.length ? list[i + 1] : null,
        next: i - 1 >= 0 ? list[i - 1] : null
      };
    }
  };

  function parseTags(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    return String(input)
      .split(/[,，]/)
      .map(t => t.trim())
      .filter(Boolean);
  }

  // ---------- 导出 / 导入 ----------
  const data = {
    exportAll() {
      return {
        version: 1,
        exportedAt: now(),
        settings: read(KEY_SETTINGS, {}),
        posts: read(KEY_POSTS, [])
      };
    },
    exportJSON() {
      const blob = new Blob([JSON.stringify(this.exportAll(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diary-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    importJSON(json, mode) {
      // mode: 'replace' 整体替换 / 'merge' 按 id 合并(已有的跳过)
      if (!json || !json.posts) throw new Error('备份文件格式不正确');
      if (mode === 'replace') {
        write(KEY_POSTS, json.posts);
        if (json.settings) write(KEY_SETTINGS, json.settings);
      } else {
        const list = read(KEY_POSTS, []);
        const ids = new Set(list.map(p => p.id));
        json.posts.forEach(p => {
          if (!ids.has(p.id)) list.push(p);
        });
        write(KEY_POSTS, list);
        if (json.settings) {
          const cur = read(KEY_SETTINGS, {});
          write(KEY_SETTINGS, Object.assign({}, cur, json.settings));
        }
      }
      return json.posts.length;
    }
  };

  // ---------- 种子数据(首次为空时填几条示例,让前台有内容看) ----------
  function seedIfEmpty() {
    const list = read(KEY_POSTS, []);
    if (list.length > 0) return;
    const sample = [
      {
        id: uid(),
        title: '欢迎来到碎碎念留档',
        content: '这里是一个私人的多作者记录站。\n\n你可以在这里写下日常、长文、图片、代码、歌单,也可以把要存档的东西备份进来。\n\n后台路径是 #/admin,默认密码在 config.js 里(请尽快改掉)。',
        author: 'archive',
        category: 'long',
        tags: ['说明', '开始'],
        images: [],
        pinned: true,
        hidden: false,
        draft: false,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: uid(),
        title: '今天的天气',
        content: '阴天,有点风。\n\n> 安静的时候最适合写点什么。',
        author: 'yu',
        category: 'daily',
        tags: ['日常'],
        images: [],
        pinned: false,
        hidden: false,
        draft: false,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now()
      }
    ];
    write(KEY_POSTS, sample);
  }

  // 暴露到全局
  window.DiaryStore = { settings, auth, posts, data, seedIfEmpty, parseTags };
})();
