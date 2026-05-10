#!/usr/bin/env bash
# =============================================================================
# OpenMgr Release Script
#
# Orchestrates a full release from your local machine:
#   1. Validates prerequisites (clean tree, gh auth, docker auth)
#   2. Creates a GitHub Release (draft)
#   3. Builds Electron apps for macOS, Linux, and Windows
#   4. Uploads Electron artifacts to the GitHub Release
#   5. Builds and pushes Docker images (full + lite, multi-arch)
#   6. Publishes the GitHub Release (undrafts it)
#
# Usage:
#   ./scripts/release.sh <version>
#
#   version — semver tag, e.g. v1.0.0
#
# Environment variables (optional):
#   SKIP_ELECTRON     — set to "true" to skip Electron builds
#   SKIP_DOCKER       — set to "true" to skip Docker builds
#   SKIP_PUSH         — set to "true" to build Docker images without pushing
#   DOCKER_PLATFORMS  — override Docker target platforms
#                       (default: linux/amd64,linux/arm64)
#
# Prerequisites:
#   - gh CLI authenticated (gh auth status)
#   - Docker with buildx, logged in to GHCR + Docker Hub
#   - macOS code signing env vars (optional, for signed builds):
#       CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID,
#       APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
# =============================================================================

set -euo pipefail

VERSION="${1:?Usage: $0 <version>  (e.g. v1.0.0)}"

# Ensure version starts with 'v'
if [[ ! "$VERSION" =~ ^v ]]; then
  echo "ERROR: Version must start with 'v' (e.g. v1.0.0)"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="${REPO_ROOT}/scripts"
cd "$REPO_ROOT"

# ── Preflight checks ────────────────────────────────────────────────────────

echo "==> Preflight checks for release ${VERSION}..."

# Check gh CLI
if ! gh auth status &>/dev/null; then
  echo "ERROR: gh CLI not authenticated. Run: gh auth login"
  exit 1
fi
echo "    gh CLI: OK"

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "WARNING: Working tree has uncommitted changes."
  read -r -p "    Continue anyway? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy] ]]; then
    exit 1
  fi
fi
echo "    git tree: OK"

# Check Docker (if not skipping)
if [ "${SKIP_DOCKER:-}" != "true" ]; then
  if ! docker info &>/dev/null; then
    echo "ERROR: Docker is not running."
    exit 1
  fi
  echo "    Docker: OK"
fi

# Check if tag already exists
if git rev-parse "$VERSION" &>/dev/null; then
  echo "WARNING: Tag ${VERSION} already exists locally."
  read -r -p "    Continue anyway? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy] ]]; then
    exit 1
  fi
fi

echo ""
echo "==> Release plan for ${VERSION}:"
[ "${SKIP_ELECTRON:-}" != "true" ] && echo "    - Build Electron apps (macOS, Linux, Windows)"
[ "${SKIP_ELECTRON:-}" != "true" ] && echo "    - Upload Electron assets to GitHub Release"
[ "${SKIP_DOCKER:-}" != "true" ]   && echo "    - Build & push Docker images (full + lite, multi-arch)"
echo "    - Publish GitHub Release"
echo ""
read -r -p "Proceed? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy] ]]; then
  echo "Aborted."
  exit 0
fi

# ── Create draft GitHub Release ──────────────────────────────────────────────

echo ""
echo "==> Creating draft GitHub Release for ${VERSION}..."

if gh release view "$VERSION" &>/dev/null; then
  echo "    Release ${VERSION} already exists, skipping creation."
else
  gh release create "$VERSION" \
    --draft \
    --title "$VERSION" \
    --generate-notes
  echo "    Draft release created."
fi

# ── Build Electron ───────────────────────────────────────────────────────────

if [ "${SKIP_ELECTRON:-}" != "true" ]; then
  echo ""
  bash "${SCRIPTS_DIR}/build-electron.sh" "$VERSION"

  echo ""
  bash "${SCRIPTS_DIR}/upload-release-assets.sh" "$VERSION"
else
  echo ""
  echo "==> Skipping Electron builds (SKIP_ELECTRON=true)"
fi

# ── Build Docker ─────────────────────────────────────────────────────────────

if [ "${SKIP_DOCKER:-}" != "true" ]; then
  echo ""
  bash "${SCRIPTS_DIR}/build-docker.sh" "$VERSION"
else
  echo ""
  echo "==> Skipping Docker builds (SKIP_DOCKER=true)"
fi

# ── Publish the release ──────────────────────────────────────────────────────

echo ""
echo "==> Publishing GitHub Release ${VERSION}..."
gh release edit "$VERSION" --draft=false
echo "    Release published!"

echo ""
echo "=============================================="
echo "  Release ${VERSION} complete!"
echo "=============================================="
echo ""
echo "  GitHub Release: https://github.com/openmgr/openmgr/releases/tag/${VERSION}"
[ "${SKIP_DOCKER:-}" != "true" ] && echo "  Docker Hub:     https://hub.docker.com/r/openmgr/server/tags"
[ "${SKIP_DOCKER:-}" != "true" ] && echo "  GHCR:           https://github.com/openmgr/openmgr/pkgs/container/openmgr-server"
echo ""
