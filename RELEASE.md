# Releasing OpenMgr

Releases are built locally and published to GitHub Releases, Docker Hub, and GHCR.

## Quick Start

```bash
./scripts/release.sh v1.0.0
```

This will:

1. Check that your environment is ready (clean git tree, `gh` authenticated, Docker running)
2. Create a **draft** GitHub Release with auto-generated release notes
3. Build Electron desktop apps for macOS, Linux, and Windows
4. Upload the Electron installers to the GitHub Release
5. Build and push Docker images (full + lite, linux/amd64 + linux/arm64)
6. Publish the GitHub Release

## Prerequisites

- **Node.js 20+** and **pnpm 9**
- **[gh CLI](https://cli.github.com/)** — authenticated with `gh auth login`
- **Docker** — running, with buildx support
  - Logged in to GHCR: `docker login ghcr.io`
  - Logged in to Docker Hub: `docker login`
  - QEMU for cross-arch builds is registered automatically by the script

### Optional: Code Signing

To produce signed/notarized macOS builds, set these environment variables before running the release:

```bash
export CSC_LINK="<base64-encoded .p12 certificate>"
export CSC_KEY_PASSWORD="<certificate password>"
export APPLE_ID="<your Apple ID>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific password>"
export APPLE_TEAM_ID="<team ID>"
```

Without these, the macOS build will still succeed but won't be signed or notarized. Windows and Linux builds from macOS are cross-compiled and unsigned.

## Scripts

| Script | pnpm alias | What it does |
|--------|-----------|--------------|
| `scripts/release.sh` | `pnpm release` | Full release (everything below) |
| `scripts/build-electron.sh` | `pnpm release:electron` | Build Electron apps for all platforms |
| `scripts/build-docker.sh` | `pnpm release:docker` | Build + push Docker images |
| `scripts/upload-release-assets.sh` | `pnpm release:upload` | Upload Electron artifacts to a GitHub Release |

All scripts take a version argument (e.g. `v1.0.0`).

## Skipping Parts of the Release

```bash
# Skip Electron, only build Docker + create release
SKIP_ELECTRON=true ./scripts/release.sh v1.0.0

# Skip Docker, only build Electron + create release
SKIP_DOCKER=true ./scripts/release.sh v1.0.0

# Build Docker images locally without pushing to registries
SKIP_PUSH=true ./scripts/build-docker.sh v1.0.0

# Only build for specific Docker platforms (default: linux/amd64,linux/arm64)
DOCKER_PLATFORMS=linux/arm64 ./scripts/build-docker.sh v1.0.0
```

## Running Individual Steps

If the full release fails partway through, you can re-run individual steps. The scripts are idempotent — the GitHub Release creation is skipped if it already exists, and `upload-release-assets.sh` overwrites existing assets.

```bash
# Re-run just the Electron build
./scripts/build-electron.sh v1.0.0

# Re-upload assets to an existing release
./scripts/upload-release-assets.sh v1.0.0

# Re-run just the Docker build + push
./scripts/build-docker.sh v1.0.0
```

## What Gets Published

### GitHub Release

- macOS: `.dmg`, `.zip`
- Windows: `.exe` (NSIS installer), `.zip`
- Linux: `.AppImage`, `.deb`
- Auto-updater manifests: `.yml`, `.yaml`, `.blockmap`

### Docker Images

Two variants, each for `linux/amd64` and `linux/arm64`:

| Variant | Tags | Description |
|---------|------|-------------|
| full | `1.0.0`, `1.0`, `1`, `latest` | All features including browser tools and ML-based memory |
| lite | `1.0.0-lite`, `1.0-lite`, `1-lite`, `latest-lite` | No Playwright/Chromium, no ML embedding deps (~300-500 MB smaller) |

Pushed to both:
- `ghcr.io/openmgr/openmgr-server`
- `openmgr/server` (Docker Hub)
