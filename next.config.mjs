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
  allowedDevOrigins: ['127.0.0.1', '100.71.171.11', '47.96.71.237', '192.168.0.107'],
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
