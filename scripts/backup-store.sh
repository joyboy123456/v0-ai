#!/bin/bash
# store.json 每小时备份脚本（cron 调用）
#
# 策略：
#   - 本地保留最近 48 份（2 天，每小时 1 份）
#   - 每天 00:xx 那份同步上传到 OSS 异地保留 30 天
#   - 磁盘水位 >=75% 时告警，>=85% 时自动清理最老备份（防撑爆磁盘）
#   - 每份备份写入后立即验证 JSON；每天 00 点额外复验最新备份
#
# 安装（root crontab）：
#   0 * * * * /opt/yibai-fission/scripts/backup-store.sh >> /opt/yibai-fission/logs/backup.log 2>&1
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/yibai-fission}"
DATA_DIR="$PROJECT_DIR/data"
STORE_FILE="$DATA_DIR/fashion-mvp-store.json"
LOG_PREFIX="[backup-store $(date '+%Y-%m-%d %H:%M:%S')]"

validate_json() {
  local file="$1"
  if node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$file"; then
    return 0
  fi
  echo "$LOG_PREFIX JSON 校验失败，已保留现场：$file" >&2
  return 1
}

# 1. 源文件存在性检查
if [ ! -f "$STORE_FILE" ]; then
  echo "$LOG_PREFIX 跳过：$STORE_FILE 不存在"
  exit 0
fi

# 2. 磁盘水位自检（>=75% 告警，>=85% 清理最老备份）
USAGE_PCT=$(df "$DATA_DIR" | awk 'NR==2 {gsub(/%/,""); print $5}')
if [ "$USAGE_PCT" -ge 75 ]; then
  echo "$LOG_PREFIX 警告：磁盘水位已达 ${USAGE_PCT}%"
fi
if [ "$USAGE_PCT" -ge 85 ]; then
  echo "$LOG_PREFIX 磁盘水位 ${USAGE_PCT}% >= 85%，清理最老备份..."
  # 按时间倒序，删最老的，直到水位降到 80% 以下或没得删
  while [ "$USAGE_PCT" -gt 80 ]; do
    OLDEST=$(ls -t "$DATA_DIR"/fashion-mvp-store.json.bak-hourly-* 2>/dev/null | tail -1)
    if [ -z "$OLDEST" ]; then break; fi
    rm -f "$OLDEST"
    echo "$LOG_PREFIX 已删除 $OLDEST"
    USAGE_PCT=$(df "$DATA_DIR" | awk 'NR==2 {gsub(/%/,""); print $5}')
  done
fi

# 3. 本地备份（带 hourly- 前缀 + 时间戳）
TS=$(date '+%Y%m%d_%H%M%S')
LOCAL_BACKUP="$DATA_DIR/fashion-mvp-store.json.bak-hourly-$TS"
cp "$STORE_FILE" "$LOCAL_BACKUP"
if ! validate_json "$LOCAL_BACKUP"; then
  exit 1
fi
echo "$LOG_PREFIX 本地备份完成：$(basename "$LOCAL_BACKUP")"

# 4. 清理超过 48 份的本地 hourly 备份
COUNT=$(ls "$DATA_DIR"/fashion-mvp-store.json.bak-hourly-* 2>/dev/null | wc -l)
if [ "$COUNT" -gt 48 ]; then
  ls -t "$DATA_DIR"/fashion-mvp-store.json.bak-hourly-* | tail -n +$((COUNT - 47)) | while read -r f; do
    rm -f "$f"
  done
  echo "$LOG_PREFIX 清理旧备份：保留最近 48 份（原有 $COUNT 份）"
fi

# 5. 每天 00-01 点那份上传 OSS 异地保留
HOUR=$(date '+%H')
if [ "$HOUR" = "00" ]; then
  LATEST_BACKUP=$(find "$DATA_DIR" -maxdepth 1 -type f \
    -name 'fashion-mvp-store.json.bak-hourly-*' -printf '%T@ %p\n' \
    | sort -nr \
    | awk 'NR == 1 { sub(/^[^ ]+ /, ""); latest=$0 } END { print latest }')
  if [ -z "$LATEST_BACKUP" ] || [ ! -f "$LATEST_BACKUP" ]; then
    echo "$LOG_PREFIX 每日校验失败：未找到 hourly 备份" >&2
    exit 1
  fi
  echo "$LOG_PREFIX 执行每日最新备份解析验证：$(basename "$LATEST_BACKUP")"
  if ! validate_json "$LATEST_BACKUP"; then
    exit 1
  fi
  echo "$LOG_PREFIX 凌晨时段，上传 OSS 异地备份..."
  if [ -f "$PROJECT_DIR/scripts/upload-backup-to-oss.mjs" ]; then
    cd "$PROJECT_DIR"
    node scripts/upload-backup-to-oss.mjs "$LOCAL_BACKUP" || echo "$LOG_PREFIX OSS 上传失败（非致命）"
  fi
fi

echo "$LOG_PREFIX 完成"
