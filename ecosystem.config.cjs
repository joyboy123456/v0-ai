/**
 * PM2 ecosystem 配置 —— Mac mini 上跑 Next.js production server。
 *
 * 由 `05-19-cloudflare-backend-foundation` PR5 引入。
 *
 * 使用方式：
 *   mkdir -p logs                   # 提前建好日志目录
 *   pnpm install
 *   pnpm build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save                        # 保存当前进程列表
 *   pm2 startup                     # 复制输出的 sudo 命令并执行，配置开机自启
 *
 * 设计要点：
 * - 文件名用 .cjs 是因为 package.json 没有 `"type": "module"`，但 PM2 默认按
 *   CommonJS 加载 ecosystem.config.js 时跟 ESM 项目冲突，统一用 .cjs 最稳。
 * - 启动命令是 `pnpm start`，等价于 `next start`（监听 PORT，默认 3000）。
 * - 敏感 env（CLOUDFLARE_*, GOOGLE_API_KEY, R2_*）**不在这里写死**，
 *   Next.js 启动时会自动从 `.env.local` 读取。
 *   只有 NODE_ENV / PORT 这种「跑生产服务必备的非敏感开关」放在 env。
 * - `cwd` 必须是 Mac mini 上项目所在的绝对路径。如果路径变更需要手动修改。
 * - 自动重启 + 内存阈值 + 日志分离，方便排查问题。
 */

module.exports = {
  apps: [
    {
      name: 'yibai-fission',
      script: 'pnpm',
      args: 'start',

      // ⚠️ Mac mini 实际项目路径。如果项目放在别处，需要手动修改。
      // 笨蛋睡醒可通过 `pwd` 在项目根目录确认实际路径。
      cwd: '/Users/shishenglin1/xinman/dianshang/v0-ai',

      // 仅放「跑生产必备的非敏感开关」。
      // 敏感 env 由 Next.js 自动从 .env.local 读取，不要硬编码到这里。
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },

      // 进程守护策略
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      max_memory_restart: '2G',

      // 日志分离 + 时间戳，方便 `tail -f logs/yibai-fission-out.log`
      out_file: './logs/yibai-fission-out.log',
      error_file: './logs/yibai-fission-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
