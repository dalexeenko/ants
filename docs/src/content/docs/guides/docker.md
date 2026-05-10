---
title: Docker Deployment
description: Run OpenMgr with Docker and Docker Compose, including full and lite image variants.
sidebar:
  order: 1
---

## Quick Start

```bash
docker run -p 6647:6647 \
  -v openmgr-data:/data \
  -v openmgr-workspaces:/workspaces \
  -e OPENMGR_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  openmgr/server
```

The server is available at `http://localhost:6647`.

## Image Variants

| Variant | Tags | Size Delta | Description |
|---------|------|-----------|-------------|
| **full** | `latest`, `x.y.z` | baseline | All features: Playwright/Chromium browser tools, ML embedding-based vector memory |
| **lite** | `lite`, `x.y.z-lite` | ~350-650 MB smaller | No Playwright/Chromium, no ML embeddings. Agents lose `browser_*` tools and use keyword-only memory search |

Choose **lite** if you don't need browser automation and want faster pulls and less disk usage.

## Docker Compose

### Full Variant

```yaml
# docker-compose.yml
services:
  openmgr:
    image: openmgr/server:latest
    ports:
      - "6647:6647"
    volumes:
      - openmgr-data:/data
      - openmgr-workspaces:/workspaces
    environment:
      - OPENMGR_ENCRYPTION_KEY=${OPENMGR_ENCRYPTION_KEY}
      - OPENMGR_HOST=0.0.0.0
    restart: unless-stopped

volumes:
  openmgr-data:
  openmgr-workspaces:
```

Run with:

```bash
# Generate an encryption key
export OPENMGR_ENCRYPTION_KEY=$(openssl rand -base64 32)

docker compose up -d
```

### Lite Variant

```bash
docker compose -f docker-compose.yml -f docker-compose.lite.yml up -d
```

## Volumes

| Mount Point | Purpose |
|-------------|---------|
| `/data` | Server data — SQLite database, encryption keys, configuration |
| `/workspaces` | Project workspace files — code, agent outputs, etc. |

:::caution
Always use named volumes or bind mounts for `/data` and `/workspaces`. Without persistent storage, you'll lose all data when the container restarts.
:::

## Environment Variables

Pass configuration via `-e` flags or a `.env` file:

```bash
docker run -p 6647:6647 \
  -v openmgr-data:/data \
  -v openmgr-workspaces:/workspaces \
  -e OPENMGR_ENCRYPTION_KEY="your-key" \
  -e OPENMGR_SECRET="your-secret" \
  -e OPENMGR_HOST=0.0.0.0 \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  openmgr/server
```

See [Configuration](/getting-started/configuration/) for the full environment variable reference.

## Production Docker Setup

For production deployments:

```bash
docker run -d \
  --name openmgr-server \
  -p 6647:6647 \
  -v /opt/openmgr/data:/data \
  -v /opt/openmgr/workspaces:/workspaces \
  -e OPENMGR_HOST=0.0.0.0 \
  -e OPENMGR_ENCRYPTION_KEY="your-base64-key" \
  -e OPENMGR_SECRET="your-secret" \
  --restart unless-stopped \
  openmgr/server
```

See the [Production Hardening guide](/guides/production/) for TLS, reverse proxy, and security recommendations.

## Building Custom Images

Build from the monorepo source:

```bash
git clone https://github.com/openmgr/openmgr.git
cd openmgr

# Build full variant
pnpm docker:build

# Build lite variant
pnpm docker:build:lite

# Run your local build
pnpm docker:run
```

The Dockerfile is at `apps/server/Dockerfile` and accepts a `VARIANT` build arg (`full` or `lite`).
