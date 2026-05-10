#!/usr/bin/env bash
# =============================================================================
# Build the Ants server Docker image locally
# =============================================================================
#
# Usage:
#   ./dev/scripts/build-server-image.sh [options]
#
# Options:
#   -d, --dockerfile PATH   Path to Dockerfile (default: ../ants/apps/server/Dockerfile)
#   -c, --context PATH      Docker build context (default: ../ants)
#   -t, --tag TAG            Image tag (default: ants/server:latest)
#   -p, --platform PLATFORM  Target platform (default: linux/arm64)
#   --no-cache               Build without Docker cache
#   -h, --help               Show this help message
#
# The defaults assume you're running from the deploy/ repo root and the
# ants monorepo is at ../ants/ (sibling directory). The Dockerfile
# must be built from the monorepo root because it uses pnpm workspace
# features to resolve internal dependencies.
#
# Examples:
#   # Build with defaults (arm64 for AWS Graviton)
#   ./dev/scripts/build-server-image.sh
#
#   # Build for local development on Apple Silicon (same arch)
#   ./dev/scripts/build-server-image.sh
#
#   # Build for amd64
#   ./dev/scripts/build-server-image.sh --platform linux/amd64
#
#   # Custom tag
#   ./dev/scripts/build-server-image.sh --tag ants/server:v1.2.3
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults (relative to the deploy repo root)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DOCKERFILE="${REPO_ROOT}/../ants/apps/server/Dockerfile"
BUILD_CONTEXT="${REPO_ROOT}/../ants"
IMAGE_TAG="ants/server:latest"
PLATFORM="linux/arm64"
NO_CACHE=""

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dockerfile)
      DOCKERFILE="$2"
      shift 2
      ;;
    -c|--context)
      BUILD_CONTEXT="$2"
      shift 2
      ;;
    -t|--tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    -p|--platform)
      PLATFORM="$2"
      shift 2
      ;;
    --no-cache)
      NO_CACHE="--no-cache"
      shift
      ;;
    -h|--help)
      sed -n '2,/^# =====/p' "$0" | head -n -1 | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------------------
DOCKERFILE="$(cd "$(dirname "$DOCKERFILE")" && pwd)/$(basename "$DOCKERFILE")"
BUILD_CONTEXT="$(cd "$BUILD_CONTEXT" && pwd)"

# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------
if [[ ! -f "$DOCKERFILE" ]]; then
  echo "Error: Dockerfile not found at $DOCKERFILE" >&2
  echo "Make sure the ants monorepo is at the expected location." >&2
  exit 1
fi

if [[ ! -d "$BUILD_CONTEXT" ]]; then
  echo "Error: Build context directory not found at $BUILD_CONTEXT" >&2
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "Error: docker is not installed or not in PATH" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
# The Dockerfile path must be relative to the build context for -f,
# but we pass absolute paths which Docker handles fine.

echo "Building server image..."
echo "  Dockerfile: $DOCKERFILE"
echo "  Context:    $BUILD_CONTEXT"
echo "  Tag:        $IMAGE_TAG"
echo "  Platform:   $PLATFORM"
echo ""

docker build \
  -f "$DOCKERFILE" \
  --platform "$PLATFORM" \
  --build-arg IMAGE_TAG="$IMAGE_TAG" \
  --build-arg ANTS_SERVER_VERSION="dev" \
  ${NO_CACHE} \
  -t "$IMAGE_TAG" \
  "$BUILD_CONTEXT"

echo ""
echo "Build complete: $IMAGE_TAG"
