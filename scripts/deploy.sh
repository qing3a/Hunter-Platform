#!/usr/bin/env bash
# scripts/deploy.sh — One-shot production deploy for qing3.top
#
# Pipeline (each step aborts on failure):
#   1. Pre-flight: verify SSH connectivity + service running
#   2. DB backup: sqlite3 ".backup" to timestamped file on prod
#   3. Build api: clean out/ + tsbuildinfo, pnpm install, pnpm build
#   4. Build admin-web: pnpm install, pnpm build → out/admin/
#   5. Stop service: systemctl stop hunter-platform
#   6. Upload api: tar out/main + out/shared + migrations → prod out/
#   7. Upload admin-web: tar out/admin → prod out/admin/ (SEPARATE step —
#      vite outputs to out/admin/, not out/main/, so we can't bundle it
#      with the api tarball; that's the bug this script prevents)
#   8. Start service: systemctl start hunter-platform
#   9. Reload nginx: nginx -t && nginx -s reload
#  10. E2E smoke: /v1/health, /v1/capabilities/by-alias, /admin/assets/*.js
#
# Usage:
#   scripts/deploy.sh                 # full deploy + e2e (default)
#   scripts/deploy.sh --dry-run       # print every command without running
#   scripts/deploy.sh --skip-admin-web   # api only (admin-web already current)
#   scripts/deploy.sh --skip-e2e      # deploy only, no smoke verification
#   scripts/deploy.sh --backup-only   # just take DB backup, exit
#
# Env vars (override defaults):
#   SSH_KEY=/d/Downloads/cc.pem       # Windows path, auto-converted by Git Bash
#   REMOTE_HOST=root@101.201.110.129
#   REMOTE_DIR=/opt/hunter-platform
#   SERVICE_NAME=hunter-platform
#   E2E_BASE=https://qing3.top

set -euo pipefail

# --- Defaults (override via env) ---
SSH_KEY="${SSH_KEY:-/d/Downloads/cc.pem}"
REMOTE_HOST="${REMOTE_HOST:-root@101.201.110.129}"
REMOTE_DIR="${REMOTE_DIR:-/opt/hunter-platform}"
SERVICE_NAME="${SERVICE_NAME:-hunter-platform}"
E2E_BASE="${E2E_BASE:-https://qing3.top}"

# --- Flags ---
DRY_RUN=0
SKIP_ADMIN=0
SKIP_E2E=0
BACKUP_ONLY=0

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)         DRY_RUN=1; shift ;;
    --skip-admin-web)  SKIP_ADMIN=1; shift ;;
    --skip-e2e)        SKIP_E2E=1; shift ;;
    --backup-only)     BACKUP_ONLY=1; shift ;;
    -h|--help)         usage 0 ;;
    *)                 echo "Unknown arg: $1" >&2; usage 2 ;;
  esac
done

# --- Pretty output ---
if [[ -t 1 ]]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BLUE=''; NC=''
fi

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# Run-or-echo. Aborts on failure unless DRY_RUN.
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo -e "${YELLOW}[DRY]${NC} $*"
  else
    "$@"
  fi
}

# --- Pre-flight ---
log "=== Pre-flight ==="

[[ -f "$SSH_KEY" ]] || fail "SSH key not found: $SSH_KEY"
ok "SSH key: $SSH_KEY"

run ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
  "$REMOTE_HOST" 'echo ok' >/dev/null \
  || fail "Cannot reach $REMOTE_HOST via SSH"
ok "SSH reachable: $REMOTE_HOST"

# --- DB backup ---
log "=== DB backup ==="
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_NAME="hunter-pre-deploy-${TIMESTAMP}.db"
run ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$REMOTE_HOST" \
  "sqlite3 ${REMOTE_DIR}/data/hunter.db \".backup ${REMOTE_DIR}/data/${BACKUP_NAME}\" \
   && ls -la ${REMOTE_DIR}/data/${BACKUP_NAME} \
   && md5sum ${REMOTE_DIR}/data/hunter.db ${REMOTE_DIR}/data/${BACKUP_NAME}"
ok "Backup created on prod: ${REMOTE_DIR}/data/${BACKUP_NAME}"

if [[ $BACKUP_ONLY -eq 1 ]]; then
  ok "Backup-only mode; exiting"
  exit 0
fi

# --- Build api ---
log "=== Build api ==="
run rm -rf out tsconfig.node.tsbuildinfo tsconfig.tsbuildinfo
ok "out/ + tsbuildinfo cleaned"

run pnpm install --frozen-lockfile
ok "pnpm install --frozen-lockfile"

run pnpm build
ok "pnpm build (api)"

# Verify migrations SQL got copied
MIG_COUNT=$(ls out/main/db/migrations/ 2>/dev/null | wc -l)
if [[ $MIG_COUNT -lt 25 ]]; then
  fail "Expected ≥25 migrations in out/main/db/migrations/, found $MIG_COUNT"
fi
ok "migrations SQL present: $MIG_COUNT files"

# --- Build admin-web ---
if [[ $SKIP_ADMIN -eq 0 ]]; then
  log "=== Build admin-web ==="
  run bash -c "cd admin-web && pnpm install --frozen-lockfile && pnpm build"
  ok "admin-web built → out/admin/"

  [[ -f out/admin/index.html ]] || fail "out/admin/index.html missing after build"
  ok "out/admin/index.html exists"
else
  warn "Skipping admin-web build (--skip-admin-web)"
fi

# --- Stop service ---
log "=== Stop service ==="
run ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$REMOTE_HOST" \
  "systemctl stop ${SERVICE_NAME} && sleep 1 && \
   systemctl is-active ${SERVICE_NAME} | grep -q '^inactive$' \
   || (systemctl status ${SERVICE_NAME} --no-pager; exit 1)"
ok "Service stopped"

# --- Upload api ---
log "=== Upload api out/ → prod ==="
run bash -c "cd out && tar czf - main shared | \
  ssh -i '$SSH_KEY' -o StrictHostKeyChecking=no $REMOTE_HOST \
    'set -e; cd ${REMOTE_DIR}/out && \
     find main shared -mindepth 1 -delete && \
     tar xzf - && \
     find main shared -type f | wc -l'"
ok "api out/ uploaded (main + shared)"

# --- Upload admin-web (separate! see header comment) ---
if [[ $SKIP_ADMIN -eq 0 ]]; then
  log "=== Upload admin-web out/admin/ → prod ==="
  run bash -c "cd out/admin && tar czf - . | \
    ssh -i '$SSH_KEY' -o StrictHostKeyChecking=no $REMOTE_HOST \
      'set -e; cd ${REMOTE_DIR}/out/admin && \
       find . -mindepth 1 -delete && \
       tar xzf - && \
       find . -type f | wc -l'"
  ok "admin-web uploaded"

  log "=== Reload nginx ==="
  run ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$REMOTE_HOST" \
    "nginx -t && nginx -s reload"
  ok "nginx reloaded"
fi

# --- Start service ---
log "=== Start service ==="
run ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$REMOTE_HOST" \
  "systemctl start ${SERVICE_NAME}"
ok "Service start issued"

# systemd takes ~2s to actually bind port 3000 (see OPERATIONS.md §3.2)
log "Waiting 4s for service to bind port 3000..."
run sleep 4

# --- E2E smoke ---
if [[ $SKIP_E2E -eq 0 ]]; then
  log "=== E2E smoke ==="
  declare -a CHECKS=(
    "GET ${E2E_BASE}/v1/health                              200"
    "GET ${E2E_BASE}/v1/capabilities                        200"
    "GET ${E2E_BASE}/v1/capabilities/by-alias/ow_recruit.advance_candidate 200"
    "GET ${E2E_BASE}/v1/admin/ping                          401"
    "GET ${E2E_BASE}/admin/                                 200"
  )

  # admin-web asset URLs use hashed names — discover them dynamically
  if [[ $SKIP_ADMIN -eq 0 ]]; then
    ADMIN_JS=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$REMOTE_HOST" \
      "ls ${REMOTE_DIR}/out/admin/assets/index-*.js 2>/dev/null | head -1 | xargs -I{} basename {}" 2>/dev/null || echo "")
    ADMIN_CSS=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$REMOTE_HOST" \
      "ls ${REMOTE_DIR}/out/admin/assets/index-*.css 2>/dev/null | head -1 | xargs -I{} basename {}" 2>/dev/null || echo "")
    [[ -n "$ADMIN_JS"  ]] && CHECKS+=("GET ${E2E_BASE}/admin/assets/${ADMIN_JS}  200")
    [[ -n "$ADMIN_CSS" ]] && CHECKS+=("GET ${E2E_BASE}/admin/assets/${ADMIN_CSS} 200")
  fi

  FAILED=0
  for entry in "${CHECKS[@]}"; do
    METHOD=$(echo "$entry" | awk '{print $1}')
    URL=$(echo    "$entry" | awk '{print $2}')
    EXPECT=$(echo "$entry" | awk '{print $3}')

    if [[ $DRY_RUN -eq 1 ]]; then
      echo -e "${YELLOW}[DRY]${NC} $METHOD $URL → expect $EXPECT"
      continue
    fi

    GOT=$(curl -sS -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo "000")
    if [[ "$GOT" == "$EXPECT" ]]; then
      ok "$METHOD $URL → $GOT"
    else
      fail "$METHOD $URL → got $GOT, expected $EXPECT"
      FAILED=$((FAILED+1))
    fi
  done

  if [[ $FAILED -gt 0 ]]; then
    fail "$FAILED E2E check(s) failed — investigate before next deploy"
  fi
  ok "All E2E checks passed"
else
  warn "Skipping E2E (--skip-e2e)"
fi

# --- Summary ---
log "=== Deploy complete ==="
echo -e "${GREEN}Backup:${NC} ${REMOTE_DIR}/data/${BACKUP_NAME}"
echo -e "${GREEN}E2E base:${NC} ${E2E_BASE}"
echo -e "${GREEN}Service:${NC} ${SERVICE_NAME} on ${REMOTE_HOST}"
ok "Done"