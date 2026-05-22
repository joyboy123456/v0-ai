#!/usr/bin/env zsh
set -euo pipefail

cd "$(dirname "$0")/.."

export CLOUDFLARE_D1_KV_TOKEN="$(
  node - <<'NODE'
const fs = require('fs')
const path = `${process.env.HOME}/Library/Preferences/.wrangler/config/default.toml`
const raw = fs.readFileSync(path, 'utf8')
const match = raw.match(/^\s*oauth_token\s*=\s*"([^"]+)"/m)
if (!match) process.exit(1)
process.stdout.write(match[1])
NODE
)"
export STORAGE_MODE=cloud
export NEXT_TELEMETRY_DISABLED=1

exec /opt/homebrew/bin/pnpm start
