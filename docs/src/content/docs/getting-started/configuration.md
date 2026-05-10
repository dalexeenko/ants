---
title: Configuration
description: Environment variables and configuration reference for the OpenMgr server.
---

OpenMgr is configured via environment variables. Copy `.env.example` to `.env` and set your values:

```bash
cp .env.example .env
```

## Required

| Variable | Description |
|----------|-------------|
| `OPENMGR_ENCRYPTION_KEY` | 32-byte base64 key for encrypting stored credentials (API keys, tokens). Generate with: `openssl rand -base64 32` |

:::caution
The encryption key is used to encrypt all stored API keys and credentials with AES-256-GCM. If you lose this key, you'll need to re-enter all provider API keys. Back it up securely.
:::

## Server Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENMGR_PORT` | `6647` | Port to listen on |
| `OPENMGR_HOST` | `127.0.0.1` | Bind address. Set to `0.0.0.0` to listen on all interfaces |
| `OPENMGR_SECRET` | Auto-generated | Bearer token for API authentication. Auto-generated on first run if not set |
| `OPENMGR_DATA_DIR` | `~/.config/openmgr-server/` | Server data directory (SQLite database, etc.) |
| `OPENMGR_WORKSPACES_DIR` | `~/openmgr/` | Root directory for project workspaces |
| `OPENMGR_AGENT_PATH` | Auto-detected | Path to the agent CLI binary |
| `OPENMGR_AUTO_INSTALL_AGENT` | `true` | Auto-install the agent binary if not found |
| `OPENMGR_MOCK_AGENT` | `false` | Use a mock agent for testing (no real LLM calls) |
| `OPENMGR_SERVER_VERSION` | | Version string for `/health` and `/info` responses |

## Multi-User Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENMGR_MULTI_USER` | `false` | Enable multi-user mode with role-based access control |
| `OPENMGR_SETUP_TOKEN` | | Token required for initial admin setup. If not set, the first visitor to `/setup` becomes admin |

When multi-user mode is enabled, the server supports:

- **Admin** — Full access, user management
- **Operator** — Create and manage projects and sessions
- **Viewer** — Read-only access

Authentication methods: local password auth and social OAuth (Google, GitHub, Microsoft).

:::note
`OPENMGR_SECRET` and `OPENMGR_MULTI_USER` are mutually exclusive. Use bearer token auth (single-user) OR multi-user mode, not both.
:::

## Web App

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENMGR_WEB_APP` | `false` | Enable the full web app UI at `/app` |

## CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENMGR_CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated list of allowed CORS origins |

## Host Security

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENMGR_ALLOWED_HOSTS` | localhost only | Comma-separated allowed Host header values. Protects against DNS rebinding. Set to `*` to allow any host |

## Notifications

| Variable | Description |
|----------|-------------|
| `OPENMGR_PUSH_CONTACT_EMAIL` | Contact email for VAPID web push notifications (e.g., `mailto:admin@example.com`) |

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Cloudflare Access

When both variables are set, Cloudflare Access JWT validation replaces bearer token auth:

| Variable | Description |
|----------|-------------|
| `OPENMGR_CF_ACCESS_TEAM_DOMAIN` | Your Cloudflare Access team domain (e.g., `https://myteam.cloudflareaccess.com`) |
| `OPENMGR_CF_ACCESS_AUD` | Application Audience (AUD) tag from your Access application config |
| `OPENMGR_CF_ACCESS_SET_IDENTITY` | Extract email from CF JWT as request identity (default: `true`) |

## Example `.env` File

```bash
# Required
OPENMGR_ENCRYPTION_KEY=your-base64-key-here

# Server
OPENMGR_PORT=6647
OPENMGR_HOST=127.0.0.1
OPENMGR_SECRET=your-secret-token

# Optional
LOG_LEVEL=info
OPENMGR_CORS_ORIGINS=http://localhost:3000,https://app.example.com
```
