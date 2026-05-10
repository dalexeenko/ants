---
title: Configuration
description: Environment variables and configuration reference for the Ants server.
---

Ants is configured via environment variables. Copy `.env.example` to `.env` and set your values:

```bash
cp .env.example .env
```

## Required

| Variable | Description |
|----------|-------------|
| `ANTS_ENCRYPTION_KEY` | 32-byte base64 key for encrypting stored credentials (API keys, tokens). Generate with: `openssl rand -base64 32` |

:::caution
The encryption key is used to encrypt all stored API keys and credentials with AES-256-GCM. If you lose this key, you'll need to re-enter all provider API keys. Back it up securely.
:::

## Server Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTS_PORT` | `6647` | Port to listen on |
| `ANTS_HOST` | `127.0.0.1` | Bind address. Set to `0.0.0.0` to listen on all interfaces |
| `ANTS_SECRET` | Auto-generated | Bearer token for API authentication. Auto-generated on first run if not set |
| `ANTS_DATA_DIR` | `~/.config/ants-server/` | Server data directory (SQLite database, etc.) |
| `ANTS_WORKSPACES_DIR` | `~/ants/` | Root directory for project workspaces |
| `ANTS_AGENT_PATH` | Auto-detected | Path to the agent CLI binary |
| `ANTS_AUTO_INSTALL_AGENT` | `true` | Auto-install the agent binary if not found |
| `ANTS_MOCK_AGENT` | `false` | Use a mock agent for testing (no real LLM calls) |
| `ANTS_SERVER_VERSION` | | Version string for `/health` and `/info` responses |

## Multi-User Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTS_MULTI_USER` | `false` | Enable multi-user mode with role-based access control |
| `ANTS_SETUP_TOKEN` | | Token required for initial admin setup. If not set, the first visitor to `/setup` becomes admin |

When multi-user mode is enabled, the server supports:

- **Admin** — Full access, user management
- **Operator** — Create and manage projects and sessions
- **Viewer** — Read-only access

Authentication methods: local password auth and social OAuth (Google, GitHub, Microsoft).

:::note
`ANTS_SECRET` and `ANTS_MULTI_USER` are mutually exclusive. Use bearer token auth (single-user) OR multi-user mode, not both.
:::

## Web App

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTS_WEB_APP` | `false` | Enable the full web app UI at `/app` |

## CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTS_CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated list of allowed CORS origins |

## Host Security

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTS_ALLOWED_HOSTS` | localhost only | Comma-separated allowed Host header values. Protects against DNS rebinding. Set to `*` to allow any host |

## Notifications

| Variable | Description |
|----------|-------------|
| `ANTS_PUSH_CONTACT_EMAIL` | Contact email for VAPID web push notifications (e.g., `mailto:admin@example.com`) |

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Cloudflare Access

When both variables are set, Cloudflare Access JWT validation replaces bearer token auth:

| Variable | Description |
|----------|-------------|
| `ANTS_CF_ACCESS_TEAM_DOMAIN` | Your Cloudflare Access team domain (e.g., `https://myteam.cloudflareaccess.com`) |
| `ANTS_CF_ACCESS_AUD` | Application Audience (AUD) tag from your Access application config |
| `ANTS_CF_ACCESS_SET_IDENTITY` | Extract email from CF JWT as request identity (default: `true`) |

## Example `.env` File

```bash
# Required
ANTS_ENCRYPTION_KEY=your-base64-key-here

# Server
ANTS_PORT=6647
ANTS_HOST=127.0.0.1
ANTS_SECRET=your-secret-token

# Optional
LOG_LEVEL=info
ANTS_CORS_ORIGINS=http://localhost:3000,https://app.example.com
```
