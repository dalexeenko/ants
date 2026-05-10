---
title: Docker Deployment
description: Run Ants with Docker and Docker Compose, including full and lite image variants.
sidebar:
  order: 1
---

## Quick Start

```bash
docker run -p 6647:6647 \
  -v ants-data:/data \
  -v ants-workspaces:/workspaces \
  -e ANTS_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  ants/server
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
  ants:
    image: ants/server:latest
    ports:
      - "6647:6647"
    volumes:
      - ants-data:/data
      - ants-workspaces:/workspaces
    environment:
      - ANTS_ENCRYPTION_KEY=${ANTS_ENCRYPTION_KEY}
      - ANTS_HOST=0.0.0.0
    restart: unless-stopped

volumes:
  ants-data:
  ants-workspaces:
```

Run with:

```bash
# Generate an encryption key
export ANTS_ENCRYPTION_KEY=$(openssl rand -base64 32)

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
  -v ants-data:/data \
  -v ants-workspaces:/workspaces \
  -e ANTS_ENCRYPTION_KEY="your-key" \
  -e ANTS_SECRET="your-secret" \
  -e ANTS_HOST=0.0.0.0 \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  ants/server
```

See [Configuration](/getting-started/configuration/) for the full environment variable reference.

## Production Docker Setup

For production deployments:

```bash
docker run -d \
  --name ants-server \
  -p 6647:6647 \
  -v /opt/ants/data:/data \
  -v /opt/ants/workspaces:/workspaces \
  -e ANTS_HOST=0.0.0.0 \
  -e ANTS_ENCRYPTION_KEY="your-base64-key" \
  -e ANTS_SECRET="your-secret" \
  --restart unless-stopped \
  ants/server
```

See the [Production Hardening guide](/guides/production/) for TLS, reverse proxy, and security recommendations.

## Building Custom Images

Build from the monorepo source:

```bash
git clone https://github.com/ants/ants.git
cd ants

# Build full variant
pnpm docker:build

# Build lite variant
pnpm docker:build:lite

# Run your local build
pnpm docker:run
```

The Dockerfile is at `apps/server/Dockerfile` and accepts a `VARIANT` build arg (`full` or `lite`).
