#!/usr/bin/env bash
# =============================================================================
# Upload Electron build artifacts to a GitHub Release
#
# Usage:
#   ./scripts/upload-release-assets.sh <version>
#
# Prerequisites:
#   - gh CLI authenticated (gh auth login)
#   - Electron builds already completed (apps/desktop/out/)
#   - GitHub Release already created for <version>
#
# Uploads: .dmg, .zip, .exe, .AppImage, .deb, .yml, .yaml, .blockmap
# =============================================================================

set -euo pipefail

VERSION="${1:?Usage: $0 <version>}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

OUT_DIR="apps/desktop/out"

if [ ! -d "$OUT_DIR" ]; then
  echo "ERROR: ${OUT_DIR} does not exist. Run build-electron.sh first."
  exit 1
fi

# Collect all release-worthy files
FILES=()
for ext in dmg zip exe AppImage deb yml yaml blockmap; do
  while IFS= read -r -d '' file; do
    FILES+=("$file")
  done < <(find "$OUT_DIR" -maxdepth 1 -name "*.${ext}" -print0 2>/dev/null)
done

if [ ${#FILES[@]} -eq 0 ]; then
  echo "ERROR: No release assets found in ${OUT_DIR}."
  exit 1
fi

echo "==> Uploading ${#FILES[@]} assets to release ${VERSION}..."
for file in "${FILES[@]}"; do
  echo "    $(basename "$file")"
done

# Upload all files to the release. --clobber overwrites if re-running.
gh release upload "$VERSION" "${FILES[@]}" --clobber

echo "==> Done. Assets uploaded to https://github.com/ants/ants/releases/tag/${VERSION}"
