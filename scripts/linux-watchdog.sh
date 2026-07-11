#!/bin/bash
# yibai-fission Linux 看门狗（cron 每分钟调用）
# - Web 进程无响应时自愈
# - 依赖/Provider 故障只告警，不盲目重启
# - 只处理新的 OOM 事件，避免历史 dmesg 每分钟重复命中
# - RSS 连续 3 分钟超过 3GB 时，先查询容量状态，空闲才优雅重启

set -u

PROJECT_DIR="/opt/yibai-fission"
APP_NAME="yibai-fission"
HEALTH_URL="http://localhost:3000/api/health"
CAPACITY_URL="http://localhost:3000/api/health/capacity"
LOG_FILE="$PROJECT_DIR/logs/watchdog.log"
OOM_FLAG="$PROJECT_DIR/logs/.last-oom-signature"
RSS_FLAG="$PROJECT_DIR/logs/.high-rss-count"
PROVIDER_FLAG="$PROJECT_DIR/logs/.provider-health-state"
RSS_LIMIT_MB=3072
RSS_SUSTAINED_CHECKS=3

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG_FILE"
}

restart_app() {
  local reason="$1"
  log "$reason → 优雅重启"
  cd "$PROJECT_DIR" || return 0
  pm2 restart "$APP_NAME" --update-env >>"$LOG_FILE" 2>&1 || \
    pm2 start ecosystem.config.cjs >>"$LOG_FILE" 2>&1
  log "→ 重启完成"
}

mkdir -p "$PROJECT_DIR/logs"
HEALTH_BODY="$(mktemp)"
CAPACITY_BODY="$(mktemp)"
trap 'rm -f "$HEALTH_BODY" "$CAPACITY_BODY"' EXIT

# 1. 只有连不上 Web 进程才重启；应用返回 503 说明进程仍存活。
HTTP_CODE="000"
for _ in 1 2 3; do
  HTTP_CODE=$(curl -sS -m 5 -o "$HEALTH_BODY" -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || true)
  HTTP_CODE=${HTTP_CODE:-000}
  if [ "$HTTP_CODE" != "000" ]; then
    break
  fi
  sleep 2
done

if [ "$HTTP_CODE" = "000" ]; then
  restart_app "Web 健康端点连续 3 次无响应"
  exit 0
elif [ "$HTTP_CODE" != "200" ]; then
  log "健康端点返回 HTTP $HTTP_CODE，判定为依赖异常，不重启 Web 进程"
fi

# Provider 全部不可用只记录状态变化，重启不能修复上游故障。
PROVIDER_STATE=$(python3 - "$HEALTH_BODY" <<'PY' 2>/dev/null || true
import json
import sys

try:
    with open(sys.argv[1], 'r', encoding='utf-8') as handle:
        providers = json.load(handle).get('providers') or []
    if providers and not any(item.get('available') for item in providers):
        print('all_unavailable')
    else:
        print('available')
except Exception:
    pass
PY
)
LAST_PROVIDER_STATE=$(cat "$PROVIDER_FLAG" 2>/dev/null || true)
if [ -n "$PROVIDER_STATE" ] && [ "$PROVIDER_STATE" != "$LAST_PROVIDER_STATE" ]; then
  if [ "$PROVIDER_STATE" = "all_unavailable" ]; then
    log "Provider 全部不可用，只告警，不重启 Web 进程"
  elif [ "$LAST_PROVIDER_STATE" = "all_unavailable" ]; then
    log "Provider 已恢复可用"
  fi
  echo "$PROVIDER_STATE" >"$PROVIDER_FLAG"
fi

# 2. 仅对 dmesg 中未处理过的最新 OOM 行记录一次。
LATEST_OOM=$(dmesg -T 2>/dev/null | grep 'Out of memory: Killed process' | tail -1 || true)
if [ -n "$LATEST_OOM" ]; then
  OOM_SIGNATURE=$(printf '%s' "$LATEST_OOM" | cksum | awk '{print $1 ":" $2}')
  LAST_OOM_SIGNATURE=$(cat "$OOM_FLAG" 2>/dev/null || true)
  if [ "$OOM_SIGNATURE" != "$LAST_OOM_SIGNATURE" ]; then
    log "检测到新 OOM Kill 事件：$LATEST_OOM"
    echo "$OOM_SIGNATURE" >"$OOM_FLAG"
  fi
fi

# 3. RSS 持续过高时先查容量接口；有在途任务或无法鉴权时保守延后。
RSS_MB=$(pm2 jlist 2>/dev/null | python3 -c "
import json, sys
try:
    for app in json.loads(sys.stdin.read()):
        if app.get('name') == '$APP_NAME':
            print(int((app.get('monit') or {}).get('memory', 0)) // 1024 // 1024)
            break
except Exception:
    pass
" 2>/dev/null || true)

HIGH_RSS_COUNT=$(cat "$RSS_FLAG" 2>/dev/null || echo 0)
case "$HIGH_RSS_COUNT" in (*[!0-9]*|'') HIGH_RSS_COUNT=0 ;; esac
if [ -n "$RSS_MB" ] && [ "$RSS_MB" -ge "$RSS_LIMIT_MB" ]; then
  HIGH_RSS_COUNT=$((HIGH_RSS_COUNT + 1))
  echo "$HIGH_RSS_COUNT" >"$RSS_FLAG"
else
  echo 0 >"$RSS_FLAG"
  HIGH_RSS_COUNT=0
fi

if [ "$HIGH_RSS_COUNT" -ge "$RSS_SUSTAINED_CHECKS" ]; then
  CAPACITY_HEADERS=()
  if [ -n "${WATCHDOG_CAPACITY_COOKIE:-}" ]; then
    CAPACITY_HEADERS=(-H "Cookie: ${WATCHDOG_CAPACITY_COOKIE}")
  fi
  CAPACITY_CODE=$(curl -sS -m 5 -o "$CAPACITY_BODY" -w '%{http_code}' \
    "${CAPACITY_HEADERS[@]}" "$CAPACITY_URL" 2>/dev/null || true)
  CAPACITY_CODE=${CAPACITY_CODE:-000}
  ACTIVE_UNITS=""
  if [ "$CAPACITY_CODE" = "200" ]; then
    ACTIVE_UNITS=$(python3 - "$CAPACITY_BODY" <<'PY' 2>/dev/null || true
import json
import sys
try:
    with open(sys.argv[1], 'r', encoding='utf-8') as handle:
        print(int(json.load(handle)['capacity']['active']))
except Exception:
    pass
PY
)
  fi

  if [ "$ACTIVE_UNITS" = "0" ]; then
    echo 0 >"$RSS_FLAG"
    restart_app "RSS ${RSS_MB}MB 已持续 ${HIGH_RSS_COUNT} 分钟且无在途生图"
    exit 0
  elif [ -n "$ACTIVE_UNITS" ]; then
    log "RSS ${RSS_MB}MB 持续过高，仍有 ${ACTIVE_UNITS} 个在途单元，延后重启"
  elif [ "$HIGH_RSS_COUNT" -eq "$RSS_SUSTAINED_CHECKS" ]; then
    log "RSS ${RSS_MB}MB 持续过高，capacity 返回 HTTP $CAPACITY_CODE，为避免中断任务暂不重启"
  fi
fi

# 4. pm2 进程存在性检查。
PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
    apps = json.loads(sys.stdin.read())
    for app in apps:
        if app.get('name') == '$APP_NAME':
            print(app.get('pm2_env', {}).get('status', 'unknown'))
            break
except Exception:
    pass
" 2>/dev/null || true)
if [ -z "$PM2_STATUS" ]; then
  log "pm2 中无 $APP_NAME 进程 → 启动"
  cd "$PROJECT_DIR" || exit 0
  pm2 start ecosystem.config.cjs >>"$LOG_FILE" 2>&1
  log "→ 启动完成"
elif [ "$PM2_STATUS" != "online" ]; then
  restart_app "pm2 状态异常 ($PM2_STATUS)"
fi

exit 0
