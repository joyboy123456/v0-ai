#!/bin/bash
# yibai-fission 端口 watchdog —— 自愈式守护 3000 端口
#
# 触发原因：之前公网客户反复遇到「正在加载工作台」卡死。root cause 是 3000 端口
#   被某个 Claude 会话 / 工程师误起的 `next dev` 占住，PM2 next start 起不来。
#
# 守护规则（每次 launchd 调度时跑一次，由 com.yibai.fission.watchdog.plist 每 60s 触发）：
#   1. 如果 3000 端口跑的是 `next-server`（生产 prod）—— 一切正常，退出。
#   2. 如果 3000 端口跑的是 `next dev`（开发模式）—— kill 它，然后 pm2 resurrect/start。
#   3. 如果 3000 端口空着 —— pm2 resurrect 拉起生产。
#   4. 如果 PM2 进程列表里 yibai-fission 不存在或 errored —— pm2 start ecosystem.config.cjs。
#
# 日志：~/Library/Logs/yibai-fission-watchdog.log（带时间戳）
set -u

LOG_FILE="$HOME/Library/Logs/yibai-fission-watchdog.log"
PROJECT_DIR="/Users/shishenglin1/xinman/dianshang/v0-ai"
PM2_BIN="/opt/homebrew/bin/pm2"
APP_NAME="yibai-fission"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG_FILE"
}

# 1. 查 3000 端口监听进程
listener_pid="$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null | head -1)"

if [ -n "$listener_pid" ]; then
  # 拿到命令行（看是 next dev 还是 next-server prod）
  cmdline="$(ps -p "$listener_pid" -o command= 2>/dev/null)"
  case "$cmdline" in
    *"next dev"*|*"node "*"next/dist/bin/next dev"*)
      log "FOUND DEV process on 3000 (pid=$listener_pid cmd=$cmdline) → killing & resurrecting prod"
      # 杀进程树
      parent_pid="$(ps -p "$listener_pid" -o ppid= 2>/dev/null | tr -d ' ')"
      kill -TERM "$listener_pid" 2>/dev/null
      [ -n "$parent_pid" ] && [ "$parent_pid" != "1" ] && kill -TERM "$parent_pid" 2>/dev/null
      sleep 2
      kill -KILL "$listener_pid" 2>/dev/null
      cd "$PROJECT_DIR" || exit 0
      "$PM2_BIN" resurrect >>"$LOG_FILE" 2>&1 || "$PM2_BIN" start ecosystem.config.cjs >>"$LOG_FILE" 2>&1
      log "→ resurrect done"
      exit 0
      ;;
    *"next-server"*)
      # prod 正常运行，啥都不做
      exit 0
      ;;
    *)
      log "UNKNOWN process on 3000 (pid=$listener_pid cmd=$cmdline) → leaving alone (manual check needed)"
      exit 0
      ;;
  esac
fi

# 2. 3000 端口空着 → 拉起 prod
log "Port 3000 IDLE → pm2 resurrect"
cd "$PROJECT_DIR" || exit 0
if ! "$PM2_BIN" resurrect >>"$LOG_FILE" 2>&1; then
  log "resurrect failed → pm2 start ecosystem.config.cjs"
  "$PM2_BIN" start ecosystem.config.cjs >>"$LOG_FILE" 2>&1 || log "ecosystem start also failed!"
fi

# 3. 兜底：PM2 list 里 yibai-fission 不在 / errored → 强制重启
status="$("$PM2_BIN" jlist 2>/dev/null | grep -o "\"name\":\"$APP_NAME\"[^}]*\"status\":\"[a-z]*\"" | grep -oE '"status":"[a-z]+"' | head -1)"
if ! echo "$status" | grep -q 'online'; then
  log "PM2 status not online ($status) → restart"
  "$PM2_BIN" restart "$APP_NAME" --update-env >>"$LOG_FILE" 2>&1
fi

exit 0
