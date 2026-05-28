# Mac mini 生产环境运维 & 开发规范

> 公网入口 `http://47.96.71.237:3000` 反代到这台 Mac mini 上跑的 Next.js 生产服务。本文档说明**如何更新代码、如何重启、如何排查**，并破除常见误解（如「Next.js 是热加载，不用重启后端」）。
>
> 适用对象：所有要修改这个项目代码 / 配置的人（包括未来的 AI Agent / Claude 会话）。

---

## 1. 架构与角色

```
[客户浏览器]
   ↓ http://47.96.71.237:3000
[阿里云 VPS nginx]
   ↓ Tailscale 100.71.171.11:3000
[Mac mini (本机)]
   └─ PM2 守护进程「yibai-fission」
      └─ pnpm start  →  next start  →  next-server (生产模式)
         读 .env.local / .next/ (生产构建产物)
```

- **Mac mini 路径**：`/Users/shishenglin1/xinman/dianshang/v0-ai`
- **进程管理**：PM2（`ecosystem.config.cjs`），App 名 `yibai-fission`
- **端口**：3000（IPv6 + IPv4）
- **生产模式**：next start，**不是 next dev**

---

## 2. ❌ 破除误解：「Next.js 是热加载，不用重启」

这是**只在开发模式（`next dev`）下成立**的特性。

| 模式 | 命令 | 代码改动后 | 适用场景 |
|---|---|---|---|
| 开发模式 | `pnpm dev` / `next dev` | ✅ HMR 自动热重载，改完即可刷新看到 | 本地写代码、调试 |
| **生产模式** | `pnpm start` / `next start` | ❌ **不会热加载**。必须 `pnpm build` 重新编译 + `pm2 restart` 重启进程 | **这台 Mac mini 跑的就是这个** |

**为什么生产模式不热加载？** `next start` 跑的是 `pnpm build` 编译出的静态 bundle（`.next/server`、`.next/static`、`.next/BUILD_ID`）。这些文件不变，进程当然不会感知到源码变化。

**禁止做的事**：在 Mac mini 上跑 `pnpm dev` 想"省事热加载"。已经撞过坑：dev 模式抢占 3000 端口 → PM2 next start 起不来 → 公网客户卡在「正在加载工作台」。现在 `package.json` 的 `predev` 钩子会直接拒绝在 Mac mini 上跑 dev（见 §6 守门机制）。

---

## 3. 标准更新流程（必背！）

### 场景 A：只改了代码（.ts / .tsx / .js / .css / 组件 / API 路由 …）

```bash
cd /Users/shishenglin1/xinman/dianshang/v0-ai
pnpm install                            # 仅当 package.json/pnpm-lock.yaml 改动时
pnpm build                              # 编译生产 bundle 写入 .next/
pm2 restart yibai-fission --update-env  # 重启进程加载新 bundle
```

⏱️ 公网下线时长：约 5–10 秒（next build 在后台不影响线上，restart 是真正的下线窗口）

### 场景 B：只改了 `.env.local`（环境变量，不动代码）

```bash
cd /Users/shishenglin1/xinman/dianshang/v0-ai
pm2 restart yibai-fission --update-env  # --update-env 是关键，强制重读 env
```

⏱️ 公网下线时长：约 3–5 秒（不用 build）

> ⚠️ **没有 `--update-env` 就不会读新的 env！** PM2 默认缓存启动时的环境变量。

### 场景 C：改了 `ecosystem.config.cjs`（PM2 配置）

```bash
cd /Users/shishenglin1/xinman/dianshang/v0-ai
pm2 delete yibai-fission                # 必须先 delete 不能 restart
pm2 start ecosystem.config.cjs
pm2 save                                # 把新配置固化到 dump.pm2，开机自启用得上
```

### 场景 D：改了 `package.json` 的 `dependencies`

```bash
cd /Users/shishenglin1/xinman/dianshang/v0-ai
pnpm install
pnpm build
pm2 restart yibai-fission --update-env
```

### 场景 E：改了静态资源（`public/` 下的图片等）

```bash
cd /Users/shishenglin1/xinman/dianshang/v0-ai
# public/ 不需要 build。但保险起见仍重启清掉缓存：
pm2 restart yibai-fission
```

---

## 4. 验证更新生效

每次重启后必跑这 3 条 curl：

```bash
# 进程层：3000 端口被 next-server（不是 next dev！）占着
lsof -nP -iTCP:3000 -sTCP:LISTEN
ps -p $(lsof -nP -iTCP:3000 -sTCP:LISTEN -t | head -1) -o command=

# HTTP 层：本机和公网都通
curl -sS http://127.0.0.1:3000/api/health
curl -sS http://47.96.71.237:3000/api/health

# 业务层：登录页可见
curl -sS -o /dev/null -w "%{http_code}\n" http://47.96.71.237:3000/login
```

预期：
- `lsof` 输出含 `next-server`（**不是** `next dev`）
- `/api/health` 返回 `{"ok":true,...}` HTTP 200
- `/login` 返回 HTTP 200

---

## 5. 登录配置说明

`.env.local` 里的 `LOCAL_AUTH_MODE` 控制是否需要登录：

```bash
LOCAL_AUTH_MODE=password      # 必须输用户名+密码登录（生产推荐）
# 或
LOCAL_AUTH_MODE=super-admin   # 跳过登录，自动以 LOCAL_SUPER_ADMIN_USERNAME 进入（演示/调试用）
```

**默认内置账号**（`lib/server/auth/user-repo.ts:47`）：
- 用户名 `user01`
- 密码 `shixue123`
- bcrypt hash 在进程启动时生成（**密码不入库**）

切换模式后必须 `pm2 restart yibai-fission --update-env` 才生效。

---

## 6. 三板斧自愈机制（已部署，无需手动维护）

为防止「next dev 抢占 3000 端口、公网客户卡 loading」反复出现，本环境已部署三道防线：

### 板斧 1：开机自启 PM2
- **文件**：`~/Library/LaunchAgents/com.yibai.fission.plist`
- **作用**：Mac mini 一开机就跑 `pm2 resurrect`，从 `~/.pm2/dump.pm2` 恢复 yibai-fission
- **重新装载**：
  ```bash
  launchctl bootout gui/$(id -u)/com.yibai.fission
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.yibai.fission.plist
  ```

### 板斧 2：dev 守门
- **文件**：`scripts/predev-guard.cjs`，挂在 `package.json` 的 `predev` 钩子
- **作用**：在 hostname 匹配 `mac-mini` 时，`pnpm dev` 会被直接拒绝
- **应急绕过**（确实需要在 Mac mini 上调试）：
  ```bash
  ALLOW_DEV_ON_THIS_HOST=1 pnpm dev
  ```
- **改 hostname 识别正则**（环境变量）：
  ```bash
  YIBAI_PROD_HOST_PATTERN='mac-mini|另一个生产 hostname' pnpm dev
  ```

### 板斧 3：3000 端口 watchdog（每 60s 跑一次）
- **文件**：`scripts/port-3000-watchdog.sh` + `~/Library/LaunchAgents/com.yibai.fission.watchdog.plist`
- **作用**：定时检查 3000 端口
  - 如果是 `next-server`（prod）→ ✅ 不动
  - 如果是 `next dev` → 🔪 kill 进程树 + `pm2 resurrect`
  - 如果空闲 → 🔄 `pm2 resurrect`，失败则 `pm2 start ecosystem.config.cjs`
  - 如果 PM2 yibai-fission 不是 online → `pm2 restart --update-env` 兜底
- **日志**：`~/Library/Logs/yibai-fission-watchdog.log`（仅在有动作时写入）
- **手动跑一次**：
  ```bash
  bash /Users/shishenglin1/xinman/dianshang/v0-ai/scripts/port-3000-watchdog.sh
  ```
- **临时停止 watchdog**（极少用到）：
  ```bash
  launchctl bootout gui/$(id -u)/com.yibai.fission.watchdog
  ```

---

## 7. 排查手册（出问题时从这里开始）

### 症状：公网首页卡在「正在加载工作台」或 502

第一步永远先看进程和日志（**不要立刻去看代码**）：

```bash
# 1. 3000 端口跑的是什么？必须是 next-server（prod）
lsof -nP -iTCP:3000 -sTCP:LISTEN
ps -p $(lsof -nP -iTCP:3000 -sTCP:LISTEN -t | head -1) -o command=
# ✓ 期望: next-server (v16.x.x)
# ✗ 异常: next dev / 空 / 其他进程

# 2. PM2 yibai-fission 是否 online
pm2 list
# ✓ 期望: yibai-fission online，uptime > 几分钟
# ✗ 异常: stopped / errored / 不存在

# 3. watchdog 最近的自愈记录
tail -50 ~/Library/Logs/yibai-fission-watchdog.log
# 看到 "FOUND DEV process on 3000 → killing" / "Port 3000 IDLE → pm2 resurrect" 就是 watchdog 已自愈

# 4. PM2 自己的错误日志
tail -100 /Users/shishenglin1/xinman/dianshang/v0-ai/logs/yibai-fission-err.log
tail -100 /Users/shishenglin1/xinman/dianshang/v0-ai/logs/yibai-fission-out.log
```

### 症状：改了代码但公网行为没变

最常见原因：**忘了 `pnpm build` 或 `pm2 restart`**。

```bash
# 看 next-server 进程启动时间是不是改完代码之后
ps -p $(lsof -nP -iTCP:3000 -sTCP:LISTEN -t | head -1) -o lstart,command
# 看 .next/BUILD_ID 时间戳是不是最新
ls -la /Users/shishenglin1/xinman/dianshang/v0-ai/.next/BUILD_ID
```

如果 BUILD_ID 时间在你改代码之前 → 没 build。如果 BUILD_ID 新但 next-server 启动时间老 → 没 restart。

### 症状：`pnpm dev` 被拒绝

正常现象，是 §6 板斧 2 守门起作用。请遵守 §3 标准更新流程。如果确实需要应急调试：
```bash
ALLOW_DEV_ON_THIS_HOST=1 pnpm dev
```

### 症状：Mac mini 重启后服务没自启

```bash
# 看 LaunchAgent 是否还在
launchctl list | grep yibai
# ✓ 期望: com.yibai.fission 和 com.yibai.fission.watchdog 都在

# 看 LaunchAgent 启动日志
tail -30 ~/Library/Logs/yibai-fission-launchagent.out.log
tail -30 ~/Library/Logs/yibai-fission-launchagent.err.log

# 如果 LaunchAgent 不在，重新装载
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.yibai.fission.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.yibai.fission.watchdog.plist
```

---

## 8. 紧急 kill 开关 / 全量重建

如果一切都坏了、需要回到一个已知良好状态：

```bash
cd /Users/shishenglin1/xinman/dianshang/v0-ai

# Step 1: 杀掉所有 3000 上的进程（包括 dev 幽灵）
PIDS=$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t)
for pid in $PIDS; do
  PPID=$(ps -p $pid -o ppid= | tr -d ' ')
  kill -TERM $pid $PPID 2>/dev/null
done
sleep 2
# 还活着就 -KILL
for pid in $PIDS; do kill -KILL $pid 2>/dev/null; done

# Step 2: 重新 build
pnpm install
pnpm build

# Step 3: PM2 干净重启
pm2 delete yibai-fission 2>/dev/null
pm2 start ecosystem.config.cjs
pm2 save

# Step 4: 验证
sleep 5
curl -sS http://127.0.0.1:3000/api/health
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

---

## 9. 一句话备忘

> **改代码 → `pnpm build` → `pm2 restart yibai-fission --update-env`。改 env → 跳过 build，但仍要 `pm2 restart … --update-env`。Mac mini 上绝不跑 `pnpm dev`。**

---

## 10. 历史背景

这套 PM2 + 三板斧机制是 2026-05-26 一次彻底根治的产物。之前公网客户反复看到「正在前往登录页 / 正在加载工作台」卡死，root cause 是**某些 Claude Code 会话 / 工程师 ssh 进 Mac mini 跑了 `pnpm dev`，dev 进程占住 3000 端口，PM2 next start 起不来，公网客户命中 dev 模式后 hydration 失败**。

每次靠手动 build + restart 修一次都是治标，Mac mini 一重启又复发。所以才上了 LaunchAgent 自启 + dev 守门 + watchdog 自愈这三板斧，从根本上保证 3000 端口永远跑 prod `next-server`。

详细修复记录参见这次 commit / chat session log。
