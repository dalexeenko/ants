#!/usr/bin/env bash
# =============================================================================
# Build and push Docker images for both variants (full + lite)
#
# Usage:
#   ./scripts/build-docker.sh <version>
#
# Builds multi-arch images (linux/amd64 + linux/arm64) and pushes to:
#   - ghcr.io/openmgr/openmgr-server
#   - openmgr/server (Docker Hub)
#
# Prerequisites:
#   - Docker with buildx support
#   - Logged in to GHCR:      docker login ghcr.io
#   - Logged in to Docker Hub: docker login
#   - QEMU registered for cross-arch builds (docker run --rm --privileged
#     multiarch/qemu-user-static --reset -p yes)
#
# Environment variables (optional):
#   DOCKER_PLATFORMS — override target platforms (default: linux/amd64,linux/arm64)
#   SKIP_PUSH       — set to "true" to build without pushing
# =============================================================================

set -euo pipefail

VERSION="${1:?Usage: $0 <version>}"
# Strip leading 'v' for image tags (v1.0.0 -> 1.0.0)
VERSION_BARE="${VERSION#v}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

GHCR_IMAGE="ghcr.io/openmgr/openmgr-server"
DOCKERHUB_IMAGE="openmgr/server"
PLATFORMS="${DOCKER_PLATFORMS:-linux/amd64,linux/arm64}"
PUSH="${SKIP_PUSH:+--load}"
PUSH="${PUSH:---push}"

# Ensure buildx builder exists
BUILDER_NAME="openmgr-release"
if ! docker buildx inspect "$BUILDER_NAME" &>/dev/null; then
  echo "==> Creating buildx builder '${BUILDER_NAME}'..."
  docker buildx create --name "$BUILDER_NAME" --driver docker-container --bootstrap
fi
docker buildx use "$BUILDER_NAME"

# Ensure QEMU is registered for multi-arch
echo "==> Ensuring QEMU is registered for cross-platform builds..."
docker run --rm --privileged multiarch/qemu-user-static --reset -p yes 2>/dev/null || true

# Extract major.minor for semver tags
MAJOR="$(echo "$VERSION_BARE" | cut -d. -f1)"
MINOR="$(echo "$VERSION_BARE" | cut -d. -f2)"
SHA="$(git rev-parse --short HEAD)"

build_variant() {
  local variant="$1"
  local suffix="$2"

  echo ""
  echo "==> Building Docker image (${variant}) for ${PLATFORMS}..."

  local tags=""
  for image in "$GHCR_IMAGE" "$DOCKERHUB_IMAGE"; do
    tags="${tags} -t ${image}:${VERSION_BARE}${suffix}"
    tags="${tags} -t ${image}:${MAJOR}.${MINOR}${suffix}"
    tags="${tags} -t ${image}:${MAJOR}${suffix}"
    tags="${tags} -t ${image}:${SHA}${suffix}"
    tags="${tags} -t ${image}:latest${suffix}"
  done

  # shellcheck disable=SC2086
  docker buildx build \
    --file apps/server/Dockerfile \
    --platform "$PLATFORMS" \
    --build-arg "VARIANT=${variant}" \
    --build-arg "IMAGE_TAG=${DOCKERHUB_IMAGE}:${VERSION_BARE}${suffix}" \
    --build-arg "OPENMGR_SERVER_VERSION=${VERSION}" \
    ${tags} \
    ${PUSH} \
    .

  echo "==> Docker image (${variant}) done."
}

build_variant "full" ""
build_variant "lite" "-lite"

echo ""
echo "==> All Docker images built and pushed for ${VERSION}."
echo "    Tags:"
echo "      ${DOCKERHUB_IMAGE}:${VERSION_BARE}, :${MAJOR}.${MINOR}, :${MAJOR}, :${SHA}, :latest"
echo "      ${DOCKERHUB_IMAGE}:${VERSION_BARE}-lite, :${MAJOR}.${MINOR}-lite, :${MAJOR}-lite, :${SHA}-lite, :latest-lite"
echo "      ${GHCR_IMAGE}:<same tags>"
