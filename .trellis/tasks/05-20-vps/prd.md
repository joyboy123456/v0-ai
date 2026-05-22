# 阿里云VPS公网入口部署

## Goal

将公网入口从 trellics 内网穿透切换到阿里云杭州 VPS (nginx 反代)，通过 Tailscale 内网连接 Mac mini，实现国内客户端低延迟稳定访问。

## 架构

```
客户浏览器
  ↓ HTTP
阿里云VPS (47.96.71.237, nginx :80)
  ↓ reverse_proxy
Mac mini Tailscale IP (100.71.171.11:3000)
  ↓
Next.js (PM2)
  ↓
Cloudflare R2/D1/KV
```

公网地址：**http://47.96.71.237**

## Decisions

### D1: 隧道方案 → Tailscale 内网

* Mac mini (100.71.171.11) 和 VPS (100.72.10.25) 都在同一 Tailnet
* VPS 上 nginx 直接反代到 Mac mini 的 Tailscale IP
* 自建 Headscale 协调服务器在杭州，延迟 15ms
* Tailscale 自动重连、WireGuard 内核

### D2: 公网访问 → VPS 公网 IP + HTTP

* 直接用 VPS 公网 IP (47.96.71.237) 访问，不走域名
* 内测阶段 HTTP 明文可接受
* 后续可加域名 + HTTPS

### D3: VPS 反代 → nginx

* VPS 上安装 nginx，配置反向代理到 100.71.171.11:3000
* 支持 SSE / 长连接（生图任务 5-8 分钟）
* 超时设为 10 分钟

### D4: Tailscale Funnel → 已验证不可行

* Funnel 公网入口 (208.111.x.x) 在海外，国内客户端访问超时
* 保留 Funnel 配置但不作为主要入口

### D5: 存储层 → 保持 Cloudflare R2/D1/KV 不变

* 本次只改公网入口层
* `STORAGE_MODE=cloud` 继续使用

## What I already know

* Mac mini Tailscale IP: 100.71.171.11 (hostname: aigc-app)
* VPS Tailscale IP: 100.72.10.25 (hostname: izbp1hv9lj21dyizzzpssjz, 公网: 47.96.71.237)
* Tailscale ping VPS → Mac mini: 15ms
* PM2 已配置好守护进程（ecosystem.config.cjs）
* `/api/health` 端点已存在
* Funnel 已验证可通过公网访问（HTTP 200）

## Requirements

* Tailscale Funnel 在后台运行，开机自启
* Funnel 进程崩溃后自动恢复
* 支持 SSE / 长连接（生图任务长达 5-8 分钟）
* 部署文档更新，替换 trellics 相关内容

## Acceptance Criteria

* [x] Tailscale Funnel 公网可访问 (https://aigc-app.tailf77070.ts.net)
* [x] HTTPS 自动证书正常
* [ ] Funnel 开机自启 + 崩溃自动恢复
* [ ] 生图任务（5-8分钟长连接）不超时
* [ ] PM2 守护 Next.js 崩溃自动恢复
* [ ] `/api/health` 通过公网返回正常状态
* [ ] 部署文档更新

## Definition of Done

* Tailscale Funnel 后台运行 + 开机自启
* PM2 守护进程正常
* 部署文档更新（替换 trellics 相关内容）
* 端到端验证通过

## Out of Scope

* 存储层变更（Cloudflare R2/D1/KV 保持）
* 业务代码修改
* VPS 上安装 nginx/caddy
* 自定义域名（内测阶段用 ts.net 足够）
* CI/CD 自动化部署

## Technical Notes

* 已执行 `tailscale set --hostname aigc-app`
* 已执行 `tailscale funnel reset && tailscale funnel --bg 3000`
* Funnel URL: https://aigc-app.tailf77070.ts.net → proxy http://127.0.0.1:3000
* VPS 作为 DERP relay 已在运行，无需额外配置
* ecosystem.config.cjs: PM2 守护 Next.js, port 3000
* middleware.ts: 已有 /api/health 端点
* next.config.mjs: allowedDevOrigins 包含 100.71.171.11 (Tailscale IP)
