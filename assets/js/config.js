// 全站配置:作者、分类、API、站点信息
// 修改这里即可调整作者/分类,无需改动其它代码
window.DiaryConfig = {
  siteTitle: '碎碎念留档',
  siteSubtitle: '私人的多作者记录站 · 不公开 · 不社交',

  // 作者/来源分类
  authors: [
    { id: 'yu',      name: '于加',       desc: '于加的碎碎念与记录。' },
    { id: 'jiang',    name: '江予朔',     desc: '江予朔写下的内容。' },
    { id: 'zhou',    name: '周叙',       desc: '周叙的部分。' },
    { id: 'archive', name: '共同存档',    desc: '我们一起保存下来的东西。' }
  ],

  // 内容分类
  categories: [
    { id: 'daily',    name: '日常碎碎念' },
    { id: 'long',     name: '长文/正式记录' },
    { id: 'photo',    name: '图片/相册' },
    { id: 'code',     name: '代码/创作' },
    { id: 'music',    name: '音乐/歌单' },
    { id: 'backup',   name: '存档/备份' }
  ],

  // 首页列表每页条数
  pageSize: 10,

  // 长文折叠阈值(字符数)
  foldLength: 600,

  // ---------- API 配置 ----------
  // 自动判断:同源走相对路径 /api,部署到子路径也正确
  apiBase: (function () {
    // 用当前 HTML 文件所在目录 + api/ 拼出 API 基址
    // 这样无论是根部署还是 GitHub Pages 子路径都能用
    var p = location.pathname.replace(/\/[^/]*$/, '/');
    return p + 'api';
  })(),

  // token 在 localStorage 里的 key
  tokenKey: 'diary.token',

  authorById(id) {
    return this.authors.find(a => a.id === id) || null;
  },
  categoryById(id) {
    return this.categories.find(c => c.id === id) || null;
  }
};
