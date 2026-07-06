#!/bin/bash
# yibai-fission Linux 看门狗（cron 每分钟调用）
#
# 职责（无人值守自愈，客户公司无技术人员）：
#   1. /api/health 连续 3 次失败 → pm2 restart
#   2. 检测 dmesg 最近 5 分钟的 OOM Kill 事件 → 记日志 + 重启
#   3. pm2 进程不存在 → pm2 start ecosystem
#
# 安装（root crontab）：
#   * * * * * /opt/yibai-fission/scripts/linux-watchdog.sh >> /opt/yibai-fission/logs/watchdog.log 2>&1
set -u

PROJECT_DIR="/opt/yibai-fission"
APP_NAME="yibai-fission"
HEALTH_URL="http://localhost:3000/api/health"
LOG_FILE="$PROJECT_DIR/logs/watchdog.log"
OOM_FLAG="$PROJECT_DIR/logs/.last-oom-check"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG_FILE"
}

mkdir -p "$PROJECT_DIR/logs"

# 1. 健康检查（最多 3 次重试，每次超时 5s）
FAIL_COUNT=0
for i in 1 2 3; do
  if curl -sf -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
    FAIL_COUNT=0
    break
  else
    FAIL_COUNT=$i
    sleep 2
  fi
done

if [ "$FAIL_COUNT" -ge 3 ]; then
  log "健康检查连续 $FAIL_COUNT 次失败 → pm2 restart"
  cd "$PROJECT_DIR" || exit 0
  pm2 restart "$APP_NAME" --update-env >>"$LOG_FILE" 2>&1 || pm2 start ecosystem.config.cjs >>"$LOG_FILE" 2>&1
  log "→ 重启完成"
  exit 0
fi

# 2. OOM 事件检测（dmesg 最近 5 分钟）
LAST_CHECK_TS=0
if [ -f "$OOM_FLAG" ]; then
  LAST_CHECK_TS=$(cat "$OOM_FLAG" 2>/dev/null || echo 0)
fi
NOW_TS=$(date +%s)
# 只看最近 5 分钟的 dmesg
RECENT_OOM=$(dmesg -T 2>/dev/null | grep "Out of memory: Killed process" | tail -5 || true)
if [ -n "$RECENT_OOM" ]; then
  log "检测到 OOM Kill 事件（最近日志）："
  echo "$RECENT_OOM" >>"$LOG_FILE"
  # 确认进程还活着
  if ! curl -sf -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "OOM 后健康检查失败 → pm2 restart"
    cd "$PROJECT_DIR" || exit 0
    pm2 restart "$APP_NAME" --update-env >>"$LOG_FILE" 2>&1
  else
    log "OOM 后进程已自动恢复（pm2 autorestart 生效），无需干预"
  fi
fi
echo "$NOW_TS" >"$OOM_FLAG"

# 3. pm2 进程存在性检查（pm2 jlist 的 status 嵌在 pm2_env 对象里）
PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
  apps = json.loads(sys.stdin.read())
  for a in apps:
    if a.get('name') == '$APP_NAME':
      print(a.get('pm2_env',{}).get('status','unknown'))
      break
except: pass
" 2>/dev/null || echo "")
if [ -z "$PM2_STATUS" ]; then
  log "pm2 中无 $APP_NAME 进程 → 启动"
  cd "$PROJECT_DIR" || exit 0
  pm2 start ecosystem.config.cjs >>"$LOG_FILE" 2>&1
  log "→ 启动完成"
elif [ "$PM2_STATUS" != "online" ]; then
  log "pm2 状态异常 ($PM2_STATUS) → restart"
  pm2 restart "$APP_NAME" --update-env >>"$LOG_FILE" 2>&1
fi

exit 0
