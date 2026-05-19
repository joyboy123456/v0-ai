/**
 * scripts/seed-d1-users.mjs
 *
 * 生成 5 个内测账号的 D1 INSERT SQL，输出到 migrations/0002_seed_users.sql。
 *
 * 设计说明
 *   * 任务 05-19-cloudflare-backend-foundation PR1 的产物。
 *   * 本脚本只生成 SQL 文件，不联网、不调用 wrangler；
 *     真正写入 D1 由 main agent 执行 `wrangler d1 execute` 完成。
 *   * 密码统一 `123456`，bcrypt cost factor 10（符合 OWASP 2024 推荐）。
 *   * 每次运行会重新 bcrypt 计算（盐随机），但用 `INSERT OR IGNORE`，
 *     已存在的 username 不会被覆盖，可安全重复运行。
 *
 * 运行方式
 *   node scripts/seed-d1-users.mjs
 *
 * （备注：任务文档里写的是 `pnpm tsx scripts/seed-d1-users.ts`，
 *  本项目目前没装 tsx，所以提供 ESM .mjs 版本，直接 node 即可。）
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import bcrypt from 'bcryptjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..')
const outputPath = resolve(projectRoot, 'migrations/0002_seed_users.sql')

// ---- 账号定义 ----
const USERS = Array.from({ length: 5 }, (_, idx) => {
  const seq = String(idx + 1).padStart(2, '0')
  return {
    username: `user${seq}`,
    password: '123456',
    displayName: `测试账号 ${seq}`,
  }
})

const BCRYPT_COST = 10

function escapeSqlString(value) {
  return value.replace(/'/g, "''")
}

function generateSql() {
  const now = Date.now()
  const lines = [
    '-- =====================================================================',
    '-- 0002_seed_users.sql',
    '--',
    '-- 自动生成：scripts/seed-d1-users.mjs',
    `-- Generated at: ${new Date(now).toISOString()}`,
    '--',
    '-- 5 个内测账号（user01 ~ user05），密码统一为 123456，bcrypt cost=10。',
    '-- 使用 INSERT OR IGNORE，可安全重复运行（已有 username 不会覆盖）。',
    '--',
    '-- 执行方式（main agent）：',
    '--   wrangler d1 execute yibai-fission-db --remote --file=migrations/0002_seed_users.sql',
    '-- =====================================================================',
    '',
  ]

  for (const user of USERS) {
    const id = randomUUID()
    const hash = bcrypt.hashSync(user.password, BCRYPT_COST)
    lines.push(
      `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at) VALUES (` +
        `'${escapeSqlString(id)}', ` +
        `'${escapeSqlString(user.username)}', ` +
        `'${escapeSqlString(hash)}', ` +
        `'${escapeSqlString(user.displayName)}', ` +
        `${now}` +
        `);`,
    )
  }

  lines.push('')
  return lines.join('\n')
}

function main() {
  const sql = generateSql()
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, sql, 'utf8')
  console.log(`[seed-d1-users] wrote ${USERS.length} users to ${outputPath}`)
  console.log(`[seed-d1-users] usernames: ${USERS.map((u) => u.username).join(', ')}`)
  console.log(`[seed-d1-users] password (all): 123456`)
}

main()
