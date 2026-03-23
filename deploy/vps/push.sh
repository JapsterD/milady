#!/usr/bin/env bash
# Push app-core fixes + built web UI to a VPS and restart Milady.
#
# Runtime uses bundled files under dist/ (especially dist/api/server.js), not only
# packages/app-core/src — after changing server.ts, run root `bun run build` (or
# build:lowcpu) locally so dist/* is updated, or set MILADY_VPS_REMOTE_BUILD=1.
#
# Credentials: optional deploy/vps/.env.deploy (gitignored). Copy from .env.deploy.example.
# Prefer SSH keys. Password auth: sshpass (brew install sshpass) or /usr/bin/expect (macOS).
#
# From repo root (after: npm run build:lowcpu):
#   bash deploy/vps/push.sh
#
# Or without .env.deploy:
#   export MILADY_VPS_HOST=root@203.0.113.10
#   bash deploy/vps/push.sh
#
# Optional env (in shell or .env.deploy):
#   MILADY_VPS_PATH=/opt/milady
#   MILADY_VPS_SERVICE=milady
#   MILADY_VPS_SSH_PORT=22
#   MILADY_VPS_PASSWORD=...   (sshpass or expect)
#   MILADY_VPS_REMOTE_BUILD=1
#   MILADY_VPS_SKIP_RESTART=1
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env.deploy" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env.deploy"
  set +a
fi

if [[ -z "${MILADY_VPS_HOST:-}" ]]; then
  echo "Set MILADY_VPS_HOST or create deploy/vps/.env.deploy (see .env.deploy.example)" >&2
  exit 1
fi

ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REMOTE="${MILADY_VPS_PATH:-/opt/milady}"
SERVICE="${MILADY_VPS_SERVICE:-milady}"
SSH_PORT="${MILADY_VPS_SSH_PORT:-22}"

if [[ -n "${MILADY_VPS_PASSWORD:-}" ]]; then
  export DEPLOY_SSH_PASSWORD="$MILADY_VPS_PASSWORD"
  export MILADY_VPS_SSH_PORT="$SSH_PORT"
  # Force password auth so pubkey does not skip ASKPASS / sshpass.
  _SSH_EXTRA=(
    -p "${SSH_PORT}"
    -o StrictHostKeyChecking=accept-new
    -o PreferredAuthentications=password
    -o PubkeyAuthentication=no
  )
  if command -v sshpass &>/dev/null; then
    export SSHPASS="$MILADY_VPS_PASSWORD"
    RSYNC_RSH="sshpass -e ssh ${_SSH_EXTRA[*]}"
    remote_shell() {
      sshpass -e ssh "${_SSH_EXTRA[@]}" "$MILADY_VPS_HOST" "$@"
    }
  else
    chmod +x "$SCRIPT_DIR/ssh-askpass.sh" 2>/dev/null || true
    export SSH_ASKPASS="$SCRIPT_DIR/ssh-askpass.sh"
    export SSH_ASKPASS_REQUIRE=force
    export DISPLAY="${DISPLAY:-:0}"
    RSYNC_RSH="ssh ${_SSH_EXTRA[*]}"
    # No controlling tty → ssh uses SSH_ASKPASS (OpenSSH 8.3+).
    rsync_pw() {
      (exec 0</dev/null rsync "$@")
    }
    remote_shell() {
      (exec 0</dev/null ssh "${_SSH_EXTRA[@]}" "$MILADY_VPS_HOST" "$@")
    }
  fi
else
  RSYNC_RSH="ssh -p ${SSH_PORT} -o StrictHostKeyChecking=accept-new"
  remote_shell() {
    ssh -p "${SSH_PORT}" -o StrictHostKeyChecking=accept-new "$MILADY_VPS_HOST" "$@"
  }
fi

if [[ ! -f "$ROOT/apps/app/dist/index.html" ]]; then
  echo "Missing $ROOT/apps/app/dist/index.html — run: npm run build:lowcpu" >&2
  exit 1
fi

echo "==> rsync app-core sources"
if declare -F rsync_pw &>/dev/null; then
  rsync_pw -avz -e "$RSYNC_RSH" \
    "$ROOT/packages/app-core/src/api/server.ts" \
    "$ROOT/packages/app-core/src/api/cloud-routes.ts" \
    "$MILADY_VPS_HOST:$REMOTE/packages/app-core/src/api/"
  rsync_pw -avz -e "$RSYNC_RSH" \
    "$ROOT/packages/app-core/src/config/brand-env.ts" \
    "$MILADY_VPS_HOST:$REMOTE/packages/app-core/src/config/"
else
  rsync -avz -e "$RSYNC_RSH" \
    "$ROOT/packages/app-core/src/api/server.ts" \
    "$ROOT/packages/app-core/src/api/cloud-routes.ts" \
    "$MILADY_VPS_HOST:$REMOTE/packages/app-core/src/api/"
  rsync -avz -e "$RSYNC_RSH" \
    "$ROOT/packages/app-core/src/config/brand-env.ts" \
    "$MILADY_VPS_HOST:$REMOTE/packages/app-core/src/config/"
fi

echo "==> rsync apps/app/dist"
if declare -F rsync_pw &>/dev/null; then
  rsync_pw -avz --delete -e "$RSYNC_RSH" \
    "$ROOT/apps/app/dist/" \
    "$MILADY_VPS_HOST:$REMOTE/apps/app/dist/"
else
  rsync -avz --delete -e "$RSYNC_RSH" \
    "$ROOT/apps/app/dist/" \
    "$MILADY_VPS_HOST:$REMOTE/apps/app/dist/"
fi

if [[ -f "$ROOT/dist/api/server.js" ]]; then
  echo "==> rsync root dist bundles (api/server.js — what Bun actually loads)"
  if declare -F rsync_pw &>/dev/null; then
    rsync_pw -avz -e "$RSYNC_RSH" "$ROOT/dist/api/server.js" "$MILADY_VPS_HOST:$REMOTE/dist/api/"
    [[ -f "$ROOT/dist/api/cloud-routes.js" ]] &&
      rsync_pw -avz -e "$RSYNC_RSH" "$ROOT/dist/api/cloud-routes.js" "$MILADY_VPS_HOST:$REMOTE/dist/api/" || true
    [[ -f "$ROOT/dist/server.js" ]] && rsync_pw -avz -e "$RSYNC_RSH" "$ROOT/dist/server.js" "$MILADY_VPS_HOST:$REMOTE/dist/" || true
    [[ -f "$ROOT/dist/eliza.js" ]] && rsync_pw -avz -e "$RSYNC_RSH" "$ROOT/dist/eliza.js" "$MILADY_VPS_HOST:$REMOTE/dist/" || true
  else
    rsync -avz -e "$RSYNC_RSH" "$ROOT/dist/api/server.js" "$MILADY_VPS_HOST:$REMOTE/dist/api/"
    [[ -f "$ROOT/dist/api/cloud-routes.js" ]] &&
      rsync -avz -e "$RSYNC_RSH" "$ROOT/dist/api/cloud-routes.js" "$MILADY_VPS_HOST:$REMOTE/dist/api/" || true
    [[ -f "$ROOT/dist/server.js" ]] && rsync -avz -e "$RSYNC_RSH" "$ROOT/dist/server.js" "$MILADY_VPS_HOST:$REMOTE/dist/" || true
    [[ -f "$ROOT/dist/eliza.js" ]] && rsync -avz -e "$RSYNC_RSH" "$ROOT/dist/eliza.js" "$MILADY_VPS_HOST:$REMOTE/dist/" || true
  fi
fi

if [[ -n "${MILADY_VPS_REMOTE_BUILD:-}" ]]; then
  echo "==> remote: bun run build:lowcpu (can take a long time)"
  remote_shell "cd $(printf '%q' "$REMOTE") && bun run build:lowcpu"
fi

if [[ -z "${MILADY_VPS_SKIP_RESTART:-}" ]]; then
  echo "==> systemctl restart $SERVICE"
  remote_shell "sudo systemctl restart $(printf '%q' "$SERVICE")"
fi

echo "Done. Check: curl -sS -H \"Host: your.domain\" http://127.0.0.1:2138/ | head -c 200"
