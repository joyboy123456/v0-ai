#!/usr/bin/env node
/* eslint-disable */
/**
 * dev 守门哨兵 —— 防止生产机器 Mac mini 上误起 `pnpm dev`。
 *
 * 触发原因：之前 mac mini 上反复出现「客户卡在正在前往登录页」的顽固问题。
 *   root cause：某次 Claude Code 会话 / 工程师 ssh 进 Mac mini 跑了 `pnpm dev`，
 *   next dev 占住 3000 端口，PM2 next start 起不来，公网客户命中 dev 模式后
 *   hydration 失败，loading 永不消失。
 *
 * 守门规则：
 *   1. 默认根据 hostname 判断是不是「生产 mac mini」。如果是，直接 exit 1 报错。
 *   2. 通过环境变量 `ALLOW_DEV_ON_THIS_HOST=1` 可以临时绕过（应急排查时使用）。
 *   3. 通过环境变量 `YIBAI_PROD_HOST_PATTERN` 可以自定义识别正则，默认匹配 mac-mini。
 *
 * 如何应急绕过：
 *   ALLOW_DEV_ON_THIS_HOST=1 pnpm dev
 */
const os = require('os')

const HOSTNAME = os.hostname()
const PATTERN = process.env.YIBAI_PROD_HOST_PATTERN || 'mac-mini|Mac-mini|MacMini'
const ALLOW = process.env.ALLOW_DEV_ON_THIS_HOST === '1'

const isProdHost = new RegExp(PATTERN).test(HOSTNAME)

if (isProdHost && !ALLOW) {
  // eslint-disable-next-line no-console
  console.error(
    '\n\x1b[31m✗ 禁止在生产机器上跑 pnpm dev！\x1b[0m\n' +
      `  hostname = ${HOSTNAME}\n` +
      '  原因：这台机器是公网客户访问的生产 Mac mini，跑 pnpm dev 会占住 3000 端口、\n' +
      '       导致 PM2 next start 起不来、客户访问被卡在「正在加载工作台」。\n\n' +
      '  正确做法：\n' +
      '    1. 改代码 → 在本地开发机跑 pnpm dev；提交后由 pm2 自动重启生产。\n' +
      '    2. 在 mac mini 上要重启服务：\n' +
      '         pnpm build\n' +
      '         pm2 restart yibai-fission --update-env\n\n' +
      '  如必须绕过守门（应急排查）：\n' +
      '    ALLOW_DEV_ON_THIS_HOST=1 pnpm dev\n',
  )
  process.exit(1)
}

if (isProdHost && ALLOW) {
  // eslint-disable-next-line no-console
  console.warn(
    '\x1b[33m⚠ ALLOW_DEV_ON_THIS_HOST=1 已开启，允许在生产机器上跑 dev（仅限应急）\x1b[0m',
  )
}
