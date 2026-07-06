/**
 * PM2 ecosystem - tongzhuang VPS production deployment.
 * 直接调用 node_modules/next/dist/bin/next start 绕过 pnpm depsCheck
 * （pnpm 11 对 ignored builds 会返回非零退出码）。
 *
 * G-fix（2026-07-06 OOM 事故后）：
 * - max_memory_restart 2560M→4096M：适配 4C8G 新机器，给 V8 + sharp + 图片缓冲留足空间
 * - node_args --max-old-space-size=3584：限制 V8 堆，超过时 GC 压缩而非 OOM
 * - kill_timeout 10000：配合 task-store SIGTERM 优雅停机，给 10s 写盘窗口
 * - 放宽 max_restarts：OOM 后冷启动有短暂内存峰值，避免被误判 flapping
 */
module.exports = {
  apps: [
    {
      name: 'yibai-fission',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p 3000',
      cwd: '/opt/yibai-fission',
      interpreter: 'node',
      node_args: '--max-old-space-size=3584',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      max_memory_restart: '4096M',
      kill_timeout: 10000,
      out_file: './logs/yibai-fission-out.log',
      error_file: './logs/yibai-fission-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
