// 数据层:从 posts/index.json 读取(由 build.js 在部署时生成)
// 内容来源:posts/*.md 文件,通过 PagesCMS / git 提交
// 所有方法都是 async,但实际只有一次网络请求(取 index.json 后本地过滤)
(function () {
  const cfg = window.DiaryConfig;

  // 单次取回的索引,内部缓存避免重复 fetch
  let _cache = null;
  let _fetching = null;

  // 拼出 index.json 的实际 URL(同源相对路径,子路径部署也正确)
  function indexUrl() {
    const p = location.pathname.replace(/\/[^/]*$/, '/');
    return p + 'posts/index.json';
  }

  async function getIndex() {
    if (_cache) return _cache;
    if (_fetching) return _fetching;
    _fetching = fetch(indexUrl(), { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        _cache = data;
        _fetching = null;
        return data;
      })
      .catch(e => {
        _fetching = null;
        throw e;
      });
    return _fetching;
  }

  // 公开列表:排除草稿 / 隐藏 / 已删除
  function visiblePosts(all) {
    return (all || []).filter(p => !p.draft && !p.hidden);
  }

  // 排序:置顶优先,然后 createdAt 降序
  function sortPosts(list) {
    return list.slice().sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  }

  function applyFilter(list, filter) {
    filter = filter || {};
    let out = list;
    if (filter.author) out = out.filter(p => p.author === filter.author);
    if (filter.category) out = out.filter(p => p.category === filter.category);
    if (filter.tag) out = out.filter(p => (p.tags || []).includes(filter.tag));
    if (filter.q) {
      const q = String(filter.q).toLowerCase();
      out = out.filter(p => {
        const hay = (
          (p.title || '') + '\n' +
          (p.content || '') + '\n' +
          (p.tags || []).join(' ')
        ).toLowerCase();
        return hay.includes(q);
      });
    }
    return out;
  }

  function paginate(list, filter) {
    const page = filter.page ? parseInt(filter.page, 10) || 1 : 1;
    const size = filter.pageSize || cfg.pageSize || 10;
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / size));
    const start = (page - 1) * size;
    return {
      list: list.slice(start, start + size),
      total,
      page,
      pages
    };
  }

  // ---------- 帖子接口(保留旧 API 形状,前端不用大改) ----------
  const posts = {
    async listPublic(filter) {
      const data = await getIndex();
      const all = sortPosts(visiblePosts(data.posts || []));
      const filtered = applyFilter(all, filter || {});
      return paginate(filtered, filter || {});
    },

    async byId(id) {
      const data = await getIndex();
      const all = visiblePosts(data.posts || []);
      const p = all.find(x => x.slug === id || x.id === id);
      // 兼容:旧路由可能传的是 id 字段;新版本 slug 即 id
      return p || null;
    },

    // 上一篇/下一篇:基于"全公开列表"找邻居
    async neighbors(id, filter) {
      const data = await getIndex();
      const all = sortPosts(visiblePosts(data.posts || []));
      const i = all.findIndex(p => p.slug === id || p.id === id);
      if (i < 0) return { prev: null, next: null };
      // list 已按时间倒序:下一篇是更早的(prev index > i),上一篇是更晚的(next index < i)
      // 但 UI 上"上一篇"通常指更早的,所以这里反过来对齐 UI 习惯
      return {
        prev: i + 1 < all.length ? all[i + 1] : null,
        next: i - 1 >= 0 ? all[i - 1] : null
      };
    },

    // 兼容字段(为渲染层):旧代码用 p.id,新代码统一用 p.slug
    // 这里在 byId 返回时补一个 id 别名
    async byIdWithAlias(id) {
      const p = await this.byId(id);
      if (p && !p.id) p.id = p.slug;
      return p;
    },

    // 统计各作者 / 分类条数(给作者页/分类页索引用)
    async counts() {
      const data = await getIndex();
      const all = visiblePosts(data.posts || []);
      const byAuthor = {}, byCategory = {};
      all.forEach(p => {
        byAuthor[p.author] = (byAuthor[p.author] || 0) + 1;
        byCategory[p.category] = (byCategory[p.category] || 0) + 1;
      });
      return { byAuthor, byCategory, total: all.length };
    }
  };

  // ---------- 鉴权(已废弃,留空兼容) ----------
  // 内容现在通过 PagesCMS + git 管理,网站本身没有"后台登录"概念
  // 旧调用方调用这些方法不会报错,但啥也不做
  const auth = {
    async login() { return { token: null }; },
    isLoggedIn() { return false; },
    logout() {}
  };

  // ---------- 标签解析 ----------
  function parseTags(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    return String(input).split(/[,，]/).map(t => t.trim()).filter(Boolean);
  }

  // ---------- 导出(给前端旧代码兜底) ----------
  // 数据已经全在 git 里了,导出备份的意义弱化;提供一个把当前 index 落地的实现
  async function downloadExportJSON() {
    const data = await getIndex();
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

  window.DiaryStore = { auth, posts, parseTags, downloadExportJSON, getIndex, visiblePosts, sortPosts };
})();
