/**
 * PM2 ecosystem - tongzhuang VPS production deployment.
 * 直接调用 node_modules/next/dist/bin/next start 绕过 pnpm depsCheck
 * （pnpm 11 对 ignored builds 会返回非零退出码）。
 *
 * 4C8G 容量保护（2026-07-11）：
 * - 保持单实例 fork，避免多进程竞争写 store.json
 * - V8 堆限制为 2560MB，为 sharp、Buffer 和系统预留内存
 * - RSS 达到 3072MB 时由 PM2 优雅重启，避免逼近系统 OOM
 * - kill_timeout 15000：给 task-store 的 SIGTERM 持久化链留足写盘时间
 */
module.exports = {
  apps: [
    {
      name: 'yibai-fission',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p 3000',
      cwd: '/opt/yibai-fission',
      interpreter: 'node',
      node_args: '--max-old-space-size=2560',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        IMAGE_GLOBAL_CONCURRENCY: '12',
        // 2026-09-02 按本机 4C8G 实测容量调参（4核/7.3G内存/node RSS 458M/余量约2.5G）：
        // provider 级并发 2→4、单用户并发 3→6、姿势裂变并发 2→4；
        // .env.local 中 provider 级 maxIpm 令牌桶仍是真实节流闸，并发不会打爆上游。
        IMAGE_PER_USER_CONCURRENCY: '6',
        IMAGE_PER_PROVIDER_CONCURRENCY: '4',
        IMAGE_QUEUE_MAX_PENDING: '200',
        PHOTO_FISSION_CONCURRENCY: '4',
        POSE_FISSION_CONCURRENCY: '4',
      },
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      max_memory_restart: '3072M',
      kill_timeout: 15000,
      kill_signal: 'SIGTERM',
      out_file: './logs/yibai-fission-out.log',
      error_file: './logs/yibai-fission-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
