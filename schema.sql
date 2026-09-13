-- D1 数据库建表语句
-- 在 Cloudflare Dashboard 或本地用 wrangler 执行:
--   wrangler d1 execute my-diary-db --file=./schema.sql          (远端)
--   wrangler d1 execute my-diary-db --local --file=./schema.sql  (本地)

-- 帖子主表
-- 注意:管理员密码不存这里,放在环境变量 ADMIN_PASSWORD(见 .dev.vars / Pages 设置)
CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,            -- 形如 p_xxx,前端生成
  title       TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',     -- yu / jiang / zhou / archive
  category    TEXT NOT NULL DEFAULT '',     -- daily/long/photo/code/music/backup
  tags        TEXT NOT NULL DEFAULT '[]',   -- JSON 数组字符串
  images      TEXT NOT NULL DEFAULT '[]',   -- JSON 数组字符串(外链或 base64)
  pinned      INTEGER NOT NULL DEFAULT 0,   -- 0/1
  hidden      INTEGER NOT NULL DEFAULT 0,   -- 0/1
  draft       INTEGER NOT NULL DEFAULT 0,   -- 0/1
  deleted_at  TEXT,                          -- 软删除时间,null 表示未删除
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_author   ON posts(author);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_created  ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_deleted  ON posts(deleted_at);
