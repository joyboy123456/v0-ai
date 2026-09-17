/*
# Create core tables for yibai-fission (users, sessions, tasks, assets)

1. Plain-English summary
   This migration creates the project's first four database tables, mirroring
   the app's existing data model (currently kept in local JSON files and
   in-process memory):
   - users:    registered accounts (username + bcrypt password hash)
   - sessions: login sessions (currently in-memory, lost on restart)
   - tasks:    async image-generation tasks (input params + results as JSON)
   - assets:   uploaded images and generated result images

2. New Tables
   - users
     - id (text, primary key, app-generated e.g. usr_<uuid>)
     - username (text, unique, not null, stored lowercase)
     - password_hash (text, not null, bcrypt)
     - display_name (text, nullable)
     - created_at (bigint, Unix epoch milliseconds, not null)
   - sessions
     - id (text, primary key, app-generated e.g. sess_<uuid>)
     - user_id (text, not null, references users.id)
     - expires_at (bigint, epoch ms, not null)
     - created_at (bigint, epoch ms, not null)
   - tasks
     - id (text, primary key, app-generated taskId)
     - user_id (text, not null, references users.id)
     - type (text, not null, feature type e.g. photo-fission / pose-fission)
     - status (text, not null: queued | running | success | partial | failed)
     - payload_json (jsonb, task input snapshot)
     - result_json (jsonb, task output snapshot)
     - created_at / updated_at (bigint, epoch ms, not null)
   - assets
     - id (text, primary key, app-generated assetId)
     - user_id (text, not null, references users.id)
     - task_id (text, nullable, references tasks.id)
     - kind (text, not null: upload | generated)
     - storage_key (text, nullable, object key when stored in object storage)
     - public_url (text, nullable)
     - mime (text, nullable)
     - bytes (bigint, nullable)
     - width / height (integer, nullable)
     - favorited (boolean, not null, default false)
     - created_at (bigint, epoch ms, not null)

3. Indexes
   - tasks(user_id, created_at desc)
   - assets(user_id, task_id)
   - sessions(user_id)
   - sessions(expires_at) for cleanup sweeps

4. Security
   - RLS is ENABLED on every table with NO anon/authenticated policies:
     the app is a server-rendered Next.js application with its own
     username/password auth (not Supabase auth), so all database access is
     performed server-side with the service role (which bypasses RLS).
     Deny-by-default RLS means the anon key can read/write nothing directly,
     which is the intended posture for this architecture.

5. Notes
   - Timestamps use bigint epoch milliseconds to match the app's existing
     types (User.createdAt, GenerationTask timestamps are epoch ms numbers).
   - All statements are idempotent (IF NOT EXISTS) and safe to re-run.
   - No destructive operations.
*/

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name  text,
  created_at    bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

CREATE TABLE IF NOT EXISTS tasks (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         text NOT NULL,
  status       text NOT NULL,
  payload_json jsonb,
  result_json  jsonb,
  created_at   bigint NOT NULL,
  updated_at   bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id     text REFERENCES tasks(id) ON DELETE SET NULL,
  kind        text NOT NULL,
  storage_key text,
  public_url  text,
  mime        text,
  bytes       bigint,
  width       integer,
  height      integer,
  favorited   boolean NOT NULL DEFAULT false,
  created_at  bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_created
  ON tasks (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assets_user_task
  ON assets (user_id, task_id);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires
  ON sessions (expires_at);

ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets   ENABLE ROW LEVEL SECURITY;
