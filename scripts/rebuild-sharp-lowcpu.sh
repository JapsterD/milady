#!/usr/bin/env bash
# Rebuild sharp against system libvips (required on x86_64 without x86-64-v2 / sse4_2).
# Prereqs (Debian/Ubuntu): apt install -y build-essential python3 pkg-config libvips-dev libglib2.0-dev
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if ! command -v pkg-config >/dev/null 2>&1; then
  echo "rebuild-sharp-lowcpu: pkg-config not found" >&2
  exit 1
fi
export CXXFLAGS="-std=gnu++17"
export CPPFLAGS="$(pkg-config --cflags vips glib-2.0 gobject-2.0)"
export LDFLAGS="$(pkg-config --libs vips)"
rm -rf node_modules/sharp
# Prevent postinstall → ensure-lowcpu-native → this script again (infinite loop).
export MILADY_SKIP_LOWCPU_SHARP_REBUILD=1
npm_config_build_from_source=true bun add sharp@0.32.6
