/**
 * PM2 ecosystem - tongzhuang VPS production deployment.
 * 直接调用 node_modules/next/dist/bin/next start 绕过 pnpm depsCheck
 * （pnpm 11 对 ignored builds 会返回非零退出码）。
 */
module.exports = {
  apps: [
    {
      name: 'yibai-fission',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p 3000',
      cwd: '/opt/yibai-fission',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        CRON_SECRET: '28031576aa57db3a4c00cec10a74cdcaf1c9e9afeca6281d',
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      max_memory_restart: '2G',
      out_file: './logs/yibai-fission-out.log',
      error_file: './logs/yibai-fission-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
