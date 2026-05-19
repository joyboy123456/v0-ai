-- =====================================================================
-- 0001_init.sql
--
-- Cloudflare D1 (SQLite) 初始化 schema —— 任务 05-19-cloudflare-backend-foundation。
--
-- 设计要点：
--   * 所有时间戳统一用 INTEGER（Unix epoch ms），不用 DATETIME。
--   * 主键统一用 TEXT（uuid 或业务字符串），避免 ROWID 跨节点漂移。
--   * 关系约束保留 FOREIGN KEY，但 D1/SQLite 默认不强制；应用层仍要做 WHERE user_id=? 过滤。
--   * 全部加 IF NOT EXISTS，让脚本对已存在的库幂等。
--
-- 执行方式（main agent）：
--   wrangler d1 execute yibai-fission-db --remote --file=migrations/0001_init.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- users 表：5 个内测账号 + 未来扩展
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    INTEGER NOT NULL
);

-- ---------------------------------------------------------------------
-- tasks 表：异步生图任务记录，替代 lib/server/task-store.ts 的进程内 Map
--   * type:   'photo-fission' | 'pose-fission' | 'ai-fashion-photo' | ...
--   * status: 'queued' | 'running' | 'success' | 'partial' | 'failed'
--   * payload_json / result_json: 任务输入 / 输出摘要，JSON 字符串
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  type          TEXT NOT NULL,
  status        TEXT NOT NULL,
  payload_json  TEXT,
  result_json   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_created
  ON tasks(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- assets 表：用户上传图 + AI 生成结果资产记录
--   * kind:   'upload' | 'generated'
--   * r2_key: R2 object key，形如 users/{userId}/uploads/{uuid}.jpg
--   * public_url: 拼好的 R2 公共访问 URL
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  task_id       TEXT,
  kind          TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  public_url    TEXT,
  mime          TEXT,
  bytes         INTEGER,
  width         INTEGER,
  height        INTEGER,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_user_task
  ON assets(user_id, task_id);
