---
title: Installation
description: All the ways to install and run Ants — npx, global install, Docker, Docker Compose, and from source.
---

## npx (quickest)

Run the server without installing anything globally:

```bash
npx @ants/server
```

This always uses the latest published version.

## Global Install

Install globally via npm for a persistent command:

```bash
npm install -g @ants/server
ants-server
```

## Docker

Run the server as a Docker container with persistent storage:

```bash
docker run -p 6647:6647 \
  -v ants-data:/data \
  -v ants-workspaces:/workspaces \
  -e ANTS_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  ants/server
```

### Image Variants

Ants publishes two Docker image variants:

| Variant | Tags | Description |
|---------|------|-------------|
| **full** (default) | `latest`, `1.2.3` | All features including Playwright/Chromium browser tools and ML embedding-based vector memory |
| **lite** | `lite`, `1.2.3-lite` | No Playwright/Chromium (~300-500 MB smaller) and no ML embedding dependencies (~50-150 MB smaller). Agents lose `browser_*` tools and fall back to keyword-only memory search |

Use the lite variant if you don't need browser automation tools and want a smaller image:

```bash
docker run -p 6647:6647 \
  -v ants-data:/data \
  -v ants-workspaces:/workspaces \
  -e ANTS_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  ants/server:lite
```

## Docker Compose

Clone the repo and use the provided compose file:

```bash
git clone https://github.com/ants/ants.git
cd ants/apps/server
docker compose up
```

For the lite variant:

```bash
docker compose -f docker-compose.yml -f docker-compose.lite.yml up
```

See the [Docker Deployment guide](/guides/docker/) for full production configuration.

## From Source

For development or customization:

```bash
# Clone the monorepo
git clone https://github.com/ants/ants.git
cd ants

# Install dependencies (requires pnpm 9+)
pnpm install

# Build all packages
pnpm build

# Run the server in development mode
cd apps/server
pnpm dev
```

### Prerequisites for Building from Source

- **Node.js** >= 20
- **pnpm** 9

### Other Apps

```bash
# Desktop app (Electron)
cd apps/desktop
pnpm dev

# Mobile app (React Native / Expo)
cd apps/mobile
npx expo start
```

## Verify Installation

After starting the server, check that it's running:

```bash
curl http://localhost:6647/health
```

You should get a `200 OK` response. The web UI is available at [http://localhost:6647](http://localhost:6647).
