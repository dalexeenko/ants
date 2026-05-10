# =============================================================================
# Ants Server Dockerfile
# =============================================================================
#
# Build context: monorepo root (ants/)
#
#   docker build -f apps/server/Dockerfile \
#     --build-arg IMAGE_TAG=ants/server:v1.0.0 \
#     --build-arg ANTS_SERVER_VERSION=v1.0.0 \
#     -t ants/server:v1.0.0 .
#
# Required build args:
#   IMAGE_TAG                — baked into the image so the server knows its own
#                              image name when spawning agent containers.
#   ANTS_SERVER_VERSION   — version string exposed via /health and /info.
#                              Use a git sha for dev builds, a release tag for CI.
#
# Optional build args:
#   VARIANT                  — "full" (default) or "lite".
#                              The lite variant omits Playwright/Chromium browser
#                              automation and heavy ML dependencies (onnxruntime)
#                              for a significantly smaller image (~300-500 MB less).
# =============================================================================

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS build

ARG VARIANT=full

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace config first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./

# Copy all package.json files for layer caching
COPY packages/core/package.json packages/core/package.json
COPY packages/auth-core/package.json packages/auth-core/package.json
COPY packages/auth-anthropic/package.json packages/auth-anthropic/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/database-core/package.json packages/database-core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/memory/package.json packages/memory/package.json
COPY packages/scheduler/package.json packages/scheduler/package.json
COPY packages/server-ui/package.json packages/server-ui/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/app-ui/package.json packages/app-ui/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/node/package.json packages/node/package.json
COPY packages/config-xdg/package.json packages/config-xdg/package.json
COPY packages/tools/package.json packages/tools/package.json
COPY packages/tools-terminal/package.json packages/tools-terminal/package.json
COPY packages/skills-loader/package.json packages/skills-loader/package.json
COPY packages/skills-content/package.json packages/skills-content/package.json
COPY packages/lsp/package.json packages/lsp/package.json
COPY packages/mcp-stdio/package.json packages/mcp-stdio/package.json
COPY packages/browser-core/package.json packages/browser-core/package.json
COPY packages/browser-sandbox/package.json packages/browser-sandbox/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/docker/package.json packages/docker/package.json
COPY packages/agent-worktree/package.json packages/agent-worktree/package.json

# Install all dependencies (including dev for building)
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/ packages/
COPY apps/server/ apps/server/

# Build everything the server needs
RUN pnpm turbo build --filter=@ants/server...

# Download Playwright's Chromium browser while all deps (including playwright)
# are still present. The browser is stored in ~/.cache/ms-playwright and will
# be copied into the production stage below.
# playwright is installed inside packages/browser-sandbox/node_modules (pnpm
# strict mode does not hoist it to root), so we use pnpm exec to find the binary.
# Skipped for the lite variant — no browser tools.
# The mkdir ensures the directory always exists so the COPY in the production
# stage doesn't fail for the lite variant.
RUN mkdir -p /root/.cache/ms-playwright && \
    if [ "$VARIANT" = "full" ]; then \
      pnpm --filter @ants/agent-browser-sandbox exec playwright install chromium; \
    fi

# Remove dev dependencies to slim down the image
RUN pnpm prune --prod

# ── Strip packages not needed at server runtime (both variants) ────────────
# The UI packages (@ants/ui, @ants/app-ui, @ants/server-ui) are
# pre-built SPAs whose dist/ is copied into apps/server/dist/ during the build
# step above. Their npm dependencies (react-native, lucide-react-native,
# react-native-web, etc.) are no longer needed — the server just serves the
# static files. Similarly, build tools like turbo, typescript, and esbuild
# survive pnpm prune but aren't needed at runtime.
RUN echo "Stripping packages not needed at server runtime..." && \
    find . -path '*/node_modules/react-native' -maxdepth 5 -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/lucide-react-native' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/lucide-react' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/react-native-web' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/react-native-svg' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/expo-sqlite' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/expo-modules-core' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/@expo' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/@react-native' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/react-devtools-core' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/turbo' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/turbo-*' -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path '*/node_modules/typescript' -type d -exec rm -rf {} + 2>/dev/null; \
    echo "Done."

# ── Lite variant: strip additional heavy optional dependencies ─────────────
# - playwright + Chromium (browser automation)
# - onnxruntime-node/web + @huggingface/transformers + sharp/@img (ML embeddings)
# The code gracefully degrades when these are missing at runtime.
RUN if [ "$VARIANT" = "lite" ]; then \
      echo "Stripping heavy dependencies for lite variant..." && \
      find . -path '*/node_modules/playwright' -type d -exec rm -rf {} + 2>/dev/null; \
      find . -path '*/node_modules/playwright-core' -type d -exec rm -rf {} + 2>/dev/null; \
      find . -path '*/node_modules/onnxruntime-node' -type d -exec rm -rf {} + 2>/dev/null; \
      find . -path '*/node_modules/onnxruntime-web' -type d -exec rm -rf {} + 2>/dev/null; \
      find . -path '*/node_modules/onnxruntime-common' -type d -exec rm -rf {} + 2>/dev/null; \
      find . -path '*/node_modules/@huggingface' -type d -exec rm -rf {} + 2>/dev/null; \
      find . -path '*/node_modules/sharp' -type d -exec rm -rf {} + 2>/dev/null; \
      find . -path '*/node_modules/@img' -type d -exec rm -rf {} + 2>/dev/null; \
      echo "Done."; \
    fi

# Clean up build artifacts that aren't needed at runtime
RUN rm -rf packages/*/src packages/*/tsconfig.json packages/*/.turbo \
    apps/server/src apps/server/tsconfig.json apps/server/.turbo \
    turbo.json tsconfig.base.json .turbo

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:20-slim

ARG VARIANT=full

ARG IMAGE_TAG
RUN test -n "${IMAGE_TAG}" || (echo "ERROR: IMAGE_TAG build arg is required. Example: --build-arg IMAGE_TAG=ants/server:v1.0.0" && exit 1)
ENV ANTS_IMAGE=${IMAGE_TAG}

ARG ANTS_SERVER_VERSION
RUN test -n "${ANTS_SERVER_VERSION}" || (echo "ERROR: ANTS_SERVER_VERSION build arg is required." && exit 1)
ENV ANTS_SERVER_VERSION=${ANTS_SERVER_VERSION}

# Bake the variant into the image so runtime code can detect it if needed.
ENV ANTS_IMAGE_VARIANT=${VARIANT}

# Install runtime system dependencies.
# The full variant includes Chromium system libraries required by Playwright.
# The lite variant only needs the base utilities.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Chromium system dependencies required by Playwright — full variant only.
# Installed as a separate layer so the lite variant doesn't pull them in.
RUN if [ "$VARIANT" = "full" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libnspr4 \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libdbus-1-3 \
        libcups2 \
        libxcb1 \
        libxkbcommon0 \
        libatspi2.0-0 \
        libx11-6 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libcairo2 \
        libpango-1.0-0 \
        libasound2 \
      && rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app

COPY --from=build /app .

# Copy the pre-downloaded Playwright browser from the build stage.
# The directory always exists (created with mkdir in the build stage) but is
# empty for the lite variant, so this is a no-op copy in that case.
COPY --from=build /root/.cache/ms-playwright /root/.cache/ms-playwright

# Make the ants-agent CLI available on PATH
ENV PATH="/app/node_modules/.bin:${PATH}"

# Prevent CLI tools (gh, gcloud, etc.) from trying to open a browser.
# BROWSER=false is a widely recognized convention; GH_BROWSER is gh-specific.
# Also install a stub xdg-open so tools that shell out to it fail fast with a
# clear message instead of hanging or failing silently.
ENV BROWSER=false
ENV GH_BROWSER=false
RUN printf '#!/bin/sh\necho "ERROR: Cannot open browser in headless container: $*" >&2\nexit 1\n' > /usr/local/bin/xdg-open \
    && chmod +x /usr/local/bin/xdg-open

ENV ANTS_HOST=0.0.0.0
ENV ANTS_PORT=6647
ENV ANTS_DATA_DIR=/data
ENV ANTS_WORKSPACES_DIR=/workspaces

VOLUME ["/data", "/workspaces"]

EXPOSE 6647

CMD ["node", "apps/server/dist/index.js"]
