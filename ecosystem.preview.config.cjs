/**
 * PM2 ecosystem —— 开发测试站（preview）配置。
 *
 * 访问入口：http://121.40.34.214:3100（安全组已开放 TCP 3100）
 * 另有 nginx preview.jjwlai.cn:80 反代到 127.0.0.1:3100（DNS 就绪后可用）。
 *
 * 与生产 yibai-fission 完全隔离：
 * - cwd 指向 /opt/yibai-fission/.preview-runtime：data/、public/、logs/ 都在这里，
 *   不碰生产 data/（fashion-mvp-store.json 等）与生产 OSS；
 * - STORAGE_MODE 强制 local + LOCAL_IMAGE_ROOT 指向预览目录，测试上传不进 OSS；
 * - NEXT_PREVIEW_DIST_DIR=.next-preview：dev 构建产物与生产 .next 分离，
 *   生产 next start 重启不受 dev 影响。
 *
 * next dev 热更新：代码保存后测试站自动生效，无需 rebuild。
 * 账号：首次搭建时从生产 data/users.json 复制而来，登录密码与生产一致；
 * 之后两边账号独立演进（测试站注册新账号不影响生产）。
 */
module.exports = {
  apps: [
    {
      name: 'yibai-preview',
      script: '/opt/yibai-fission/node_modules/next/dist/bin/next',
      args: 'dev /opt/yibai-fission -H 0.0.0.0 -p 3100',
      cwd: '/opt/yibai-fission/.preview-runtime',
      interpreter: 'node',
      node_args: '--max-old-space-size=2560',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'development',
        PORT: '3100',
        NEXT_PREVIEW_DIST_DIR: '.next-preview',
        STORAGE_MODE: 'local',
        LOCAL_IMAGE_ROOT: '/opt/yibai-fission/.preview-runtime/public',
        // 测试站收紧生图并发，避免与生产抢供应商配额
        IMAGE_GLOBAL_CONCURRENCY: '2',
        IMAGE_PER_USER_CONCURRENCY: '1',
      },
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      max_memory_restart: '3072M',
      kill_timeout: 15000,
      kill_signal: 'SIGTERM',
      out_file: '/opt/yibai-fission/.preview-runtime/logs/out.log',
      error_file: '/opt/yibai-fission/.preview-runtime/logs/err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
