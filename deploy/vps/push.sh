#!/usr/bin/env bash
# Push app-core fixes + built web UI to a VPS and restart Milady.
#
# Runtime uses bundled files under dist/ (especially dist/api/server.js), not only
# packages/app-core/src — after changing server.ts, run root `bun run build` (or
# build:lowcpu) locally so dist/* is updated, or set MILADY_VPS_REMOTE_BUILD=1.
#
# From repo root (after: cd apps/app && bun run build):
#   export MILADY_VPS_HOST=root@203.0.113.10
#   bash deploy/vps/push.sh
#
# Optional:
#   MILADY_VPS_PATH=/opt/milady          (remote tree)
#   MILADY_VPS_SERVICE=milady            (systemctl restart name)
#   MILADY_VPS_REMOTE_BUILD=1            (run bun run build:lowcpu on server after rsync)
#   MILADY_VPS_SKIP_RESTART=1            (only rsync)
#
set -euo pipefail

if [[ -z "${MILADY_VPS_HOST:-}" ]]; then
  echo "Set MILADY_VPS_HOST, e.g. export MILADY_VPS_HOST=root@your.server" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE="${MILADY_VPS_PATH:-/opt/milady}"
SERVICE="${MILADY_VPS_SERVICE:-milady}"

if [[ ! -f "$ROOT/apps/app/dist/index.html" ]]; then
  echo "Missing $ROOT/apps/app/dist/index.html — run: cd apps/app && bun run build" >&2
  exit 1
fi

echo "==> rsync app-core sources"
rsync -avz \
  "$ROOT/packages/app-core/src/api/server.ts" \
  "$MILADY_VPS_HOST:$REMOTE/packages/app-core/src/api/"
rsync -avz \
  "$ROOT/packages/app-core/src/config/brand-env.ts" \
  "$MILADY_VPS_HOST:$REMOTE/packages/app-core/src/config/"

echo "==> rsync apps/app/dist"
rsync -avz --delete \
  "$ROOT/apps/app/dist/" \
  "$MILADY_VPS_HOST:$REMOTE/apps/app/dist/"

if [[ -f "$ROOT/dist/api/server.js" ]]; then
  echo "==> rsync root dist bundles (api/server.js — what Bun actually loads)"
  rsync -avz "$ROOT/dist/api/server.js" "$MILADY_VPS_HOST:$REMOTE/dist/api/"
  [[ -f "$ROOT/dist/server.js" ]] && rsync -avz "$ROOT/dist/server.js" "$MILADY_VPS_HOST:$REMOTE/dist/" || true
  [[ -f "$ROOT/dist/eliza.js" ]] && rsync -avz "$ROOT/dist/eliza.js" "$MILADY_VPS_HOST:$REMOTE/dist/" || true
fi

if [[ -n "${MILADY_VPS_REMOTE_BUILD:-}" ]]; then
  echo "==> remote: bun run build:lowcpu (can take a long time)"
  ssh "$MILADY_VPS_HOST" "cd $(printf '%q' "$REMOTE") && bun run build:lowcpu"
fi

if [[ -z "${MILADY_VPS_SKIP_RESTART:-}" ]]; then
  echo "==> systemctl restart $SERVICE"
  ssh "$MILADY_VPS_HOST" "sudo systemctl restart $(printf '%q' "$SERVICE")"
fi

echo "Done. Check: curl -sS -H \"Host: your.domain\" http://127.0.0.1:2138/ | head -c 200"
