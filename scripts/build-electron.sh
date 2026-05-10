#!/usr/bin/env bash
# =============================================================================
# Build Electron apps for all platforms (macOS, Linux, Windows)
#
# Usage:
#   ./scripts/build-electron.sh <version>
#
# Environment variables (optional):
#   CSC_LINK                      — macOS code signing certificate (base64 .p12)
#   CSC_KEY_PASSWORD              — macOS certificate password
#   APPLE_ID                      — Apple ID for notarization
#   APPLE_APP_SPECIFIC_PASSWORD   — App-specific password for notarization
#   APPLE_TEAM_ID                 — Apple Developer Team ID
#   WIN_CSC_LINK                  — Windows code signing certificate (base64 .p12)
#   WIN_CSC_KEY_PASSWORD          — Windows certificate password
#
# Outputs:
#   apps/desktop/out/ — .dmg, .zip, .exe, .AppImage, .deb, .yml, .yaml, .blockmap
# =============================================================================

set -euo pipefail

VERSION="${1:?Usage: $0 <version>}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Building Electron apps for version ${VERSION}"

# Ensure the monorepo is built
echo "==> Building monorepo..."
pnpm turbo build --force

# Clean previous output
rm -rf apps/desktop/out

# Rebuild native modules for Electron
echo "==> Rebuilding native modules for Electron..."
pnpm --filter @ants/app-electron exec electron-rebuild -f -w better-sqlite3,keytar,node-pty

# --- macOS ---
echo "==> Packaging Electron app for macOS..."
pnpm --filter @ants/app-electron exec electron-builder --mac

# --- Linux ---
echo "==> Packaging Electron app for Linux..."
pnpm --filter @ants/app-electron exec electron-builder --linux

# --- Windows ---
echo "==> Packaging Electron app for Windows..."
pnpm --filter @ants/app-electron exec electron-builder --win

echo "==> Electron builds complete. Output in apps/desktop/out/"
ls -lh apps/desktop/out/
