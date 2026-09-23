// 极简 hash 路由:支持 async handler,把 #/author/yu 之类的路径分发到对应处理函数
// 不引入框架,改路由只改这里和 app.js 里的注册
(function () {
  const routes = [];
  let notFound = null;

  function parse() {
    let h = location.hash || '#/';
    if (h[0] === '#') h = h.slice(1);
    if (h[0] !== '/') h = '/' + h;
    const [path, query] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = {};
    if (query) {
      query.split('&').forEach(kv => {
        const [k, v] = kv.split('=');
        params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    return { path, parts, params };
  }

  function match(parsed) {
    for (const r of routes) {
      const seg = r.path.split('/').filter(Boolean);
      if (seg.length !== parsed.parts.length) continue;
      const args = {};
      let ok = true;
      for (let i = 0; i < seg.length; i++) {
        if (seg[i].startsWith(':')) args[seg[i].slice(1)] = decodeURIComponent(parsed.parts[i]);
        else if (seg[i] !== parsed.parts[i]) { ok = false; break; }
      }
      if (ok) return { route: r, args, params: parsed.params };
    }
    return null;
  }

  // loading 占位
  function showLoading() {
    const v = document.getElementById('view');
    if (v) v.innerHTML = '<p class="empty" style="padding:60px 0">加载中…</p>';
  }
  function showError(e) {
    const v = document.getElementById('view');
    if (v) v.innerHTML = `<p class="empty" style="padding:60px 0">出错了: ${e && e.message ? e.message : '未知错误'}<br><a href="#/">回首页</a></p>`;
  }

  async function dispatch() {
    const parsed = parse();
    const hit = match(parsed);
    window.scrollTo(0, 0);
    if (hit) {
      try {
        showLoading();
        const ret = hit.route.handler(hit.args, hit.params);
        if (ret && typeof ret.then === 'function') await ret;
      } catch (e) {
        console.error(e);
        showError(e);
      }
    } else if (notFound) {
      notFound();
    } else {
      document.getElementById('view').innerHTML = '<p>找不到这个页面。</p>';
    }
  }

  const router = {
    on(path, handler) {
      routes.push({ path, handler });
      return this;
    },
    notFound(handler) {
      notFound = handler;
      return this;
    },
    start() {
      window.addEventListener('hashchange', dispatch);
      if (!location.hash) location.hash = '#/';
      else dispatch();
    },
    go(path) {
      if (path[0] !== '#') path = '#' + (path[0] === '/' ? path : '/' + path);
      location.hash = path;
    },
    refresh() { dispatch(); }
  };

  window.DiaryRouter = router;
})();
