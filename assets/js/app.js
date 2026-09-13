// 入口:注册路由、初始化、处理 SPA 回退
(function () {
  const router = window.DiaryRouter;
  const V = window.DiaryView;
  const A = window.DiaryAdmin;
  const cfg = window.DiaryConfig;
  const store = window.DiaryStore;
  const md = window.DiaryMD;

  // 写入站点标题
  function applyMeta() {
    document.getElementById('brand-title').textContent = cfg.siteTitle;
    document.getElementById('brand-sub').textContent = cfg.siteSubtitle;
    document.title = cfg.siteTitle + ' · ' + cfg.siteSubtitle;
    document.getElementById('footer-text').textContent = '私人记录站 · 不是公开社交平台';
  }

  // 路由表
  router
    .on('/',          V.pageHome)
    .on('/list',      V.pageList)
    .on('/author',    V.pageAuthorIndex)
    .on('/author/:id',V.pageAuthor)
    .on('/category',  V.pageCategoryIndex)
    .on('/category/:id', V.pageCategory)
    .on('/tag/:name', V.pageTag)
    .on('/post/:id',  V.pagePost)
    .on('/about',     V.pageAbout)
    .on('/search',    V.pageSearch)
    // 后台
    .on('/admin',            A.list)
    .on('/admin/new',        A.editor)
    .on('/admin/edit/:id',   A.editor)
    .on('/admin/drafts',     A.drafts)
    .on('/admin/trash',      A.trash)
    .on('/admin/settings',   A.settings)
    .notFound(() => {
      document.getElementById('view').innerHTML =
        '<p class="empty">找不到这个页面。<br><a href="#/">回首页</a></p>';
    });

  function init() {
    applyMeta();
    md.bindFoldToggle();
    router.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
