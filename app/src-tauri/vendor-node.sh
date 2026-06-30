#!/usr/bin/env bash
# Vendor the Node runtime as the Tauri sidecar (binaries/node-<target-triple>), so a
# packaged build needs no system Node. The binary is gitignored (per-platform,
# ~80-120MB) — run this once before `tauri build` on a fresh checkout or new platform,
# and again after a Node major bump (keep it matching the ABI the native modules in
# .output/server/node_modules were built for).
#
# Defaults to this host's triple; set TARGET_TRIPLE to vendor for a cross-compile
# target instead (e.g. building x86_64 macOS on an arm64 runner):
#
#   NODE_VERSION=24.18.0 ./vendor-node.sh
#   TARGET_TRIPLE=x86_64-apple-darwin ./vendor-node.sh
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-24.18.0}"
TRIPLE="${TARGET_TRIPLE:-$(rustc -Vv | sed -n 's/host: //p')}"
DIR="$(cd "$(dirname "$0")" && pwd)"

case "$TRIPLE" in
  x86_64-unknown-linux-gnu)   NODE_ARCH=linux-x64 ;;
  aarch64-unknown-linux-gnu)  NODE_ARCH=linux-arm64 ;;
  x86_64-apple-darwin)        NODE_ARCH=darwin-x64 ;;
  aarch64-apple-darwin)       NODE_ARCH=darwin-arm64 ;;
  x86_64-pc-windows-msvc)     NODE_ARCH=win-x64 ;;
  *) echo "unsupported target triple: $TRIPLE" >&2; exit 1 ;;
esac

mkdir -p "$DIR/binaries"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ "$NODE_ARCH" == win-* ]]; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$NODE_ARCH.zip" -o "$TMP/node.zip"
  # extract with whatever's available (Git Bash often lacks unzip; 7z/bsdtar do zip)
  if command -v unzip >/dev/null 2>&1; then unzip -q "$TMP/node.zip" -d "$TMP"
  elif command -v 7z >/dev/null 2>&1; then 7z x -o"$TMP" "$TMP/node.zip" >/dev/null
  else tar -xf "$TMP/node.zip" -C "$TMP"; fi
  cp "$TMP/node-v$NODE_VERSION-$NODE_ARCH/node.exe" "$DIR/binaries/node-$TRIPLE.exe"
else
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$NODE_ARCH.tar.xz" -o "$TMP/node.tar.xz"
  tar -xJf "$TMP/node.tar.xz" -C "$TMP" "node-v$NODE_VERSION-$NODE_ARCH/bin/node"
  cp "$TMP/node-v$NODE_VERSION-$NODE_ARCH/bin/node" "$DIR/binaries/node-$TRIPLE"
  chmod +x "$DIR/binaries/node-$TRIPLE"
fi

echo "vendored node v$NODE_VERSION -> binaries/node-$TRIPLE"
