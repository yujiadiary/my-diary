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

  // 内容来源:posts/*.md 文件,通过 PagesCMS / git 提交
  // 部署时由 build.js 扫描生成 posts/index.json,前台 fetch 这个文件
  // 无后端,无登录,跨设备刷新即同步

  authorById(id) {
    return this.authors.find(a => a.id === id) || null;
  },
  categoryById(id) {
    return this.categories.find(c => c.id === id) || null;
  }
};
