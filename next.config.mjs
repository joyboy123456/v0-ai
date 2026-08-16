import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 测试站（pm2 yibai-preview）用独立 distDir，避免 next dev 与生产 next start
  // 共用 .next 目录互相污染（dev 会写 .next/dev，生产重启有读坏构建的风险）。
  // 生产进程不设 NEXT_PREVIEW_DIST_DIR，保持默认 .next 不变。
  distDir: process.env.NEXT_PREVIEW_DIST_DIR ?? '.next',
  // ali-oss 是 CommonJS 包，Turbopack 对其做动态 import() 打包时会报
  // `name is not defined`。外置后由 Node.js 运行时直接 require 加载，
  // 既绕开 Turbopack 的 CJS→ESM 动态 interop bug，又保留 storage-adapter
  // 里"local 模式不加载 ali-oss"的延迟加载设计。
  serverExternalPackages: ['ali-oss'],
  // dev 服务器的 Origin 白名单：浏览器带非本机 Origin 请求 dev 资源（HMR、按需编译的
  // JS chunk）时，不在白名单里的来源会被 403，导致页面拿不到 JS、永远停在 SSR 骨架。
  // 测试站可经 公网IP:3100 或 preview.jjwlai.cn(80 反代) 访问，两者都要在白名单里；
  // 换 IP / 换域名时同步更新。
  allowedDevOrigins: [
    '127.0.0.1',
    '100.71.171.11',
    '47.96.71.237',
    '192.168.0.107',
    '121.40.34.214',
    'preview.jjwlai.cn',
  ],
  turbopack: {
    root: projectRoot,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    proxyClientMaxBodySize: '100mb',
  },
}

export default nextConfig
