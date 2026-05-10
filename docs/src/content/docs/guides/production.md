---
title: Production Hardening
description: Best practices for running OpenMgr in production — TLS, reverse proxy, security, and monitoring.
sidebar:
  order: 2
---

## Checklist

Before exposing OpenMgr to the internet:

1. **Set a strong encryption key** — `openssl rand -base64 32`
2. **Set a stable secret** — `OPENMGR_SECRET` for a known bearer token, or enable multi-user mode
3. **Use HTTPS** — Put a reverse proxy in front for TLS termination
4. **Bind to all interfaces** — `OPENMGR_HOST=0.0.0.0`
5. **Configure CORS** — `OPENMGR_CORS_ORIGINS` for your app domains
6. **Restrict allowed hosts** — `OPENMGR_ALLOWED_HOSTS` for DNS rebinding protection
7. **Persist data** — Use Docker volumes or bind mounts for `/data` and `/workspaces`

## Reverse Proxy Setup

### Caddy (recommended — automatic HTTPS)

```
openmgr.yourdomain.com {
    reverse_proxy localhost:6647
}
```

Caddy automatically provisions and renews TLS certificates via Let's Encrypt.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name openmgr.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:6647;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (for terminals)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Cloudflare Tunnel

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Create and configure a tunnel
cloudflared tunnel create openmgr
cloudflared tunnel route dns openmgr openmgr.yourdomain.com
cloudflared tunnel run openmgr
```

## Cloudflare Access

For zero-trust authentication, use Cloudflare Access instead of bearer tokens:

```bash
OPENMGR_CF_ACCESS_TEAM_DOMAIN=https://myteam.cloudflareaccess.com
OPENMGR_CF_ACCESS_AUD=your-application-audience-tag
```

When configured, Cloudflare Access JWT validation replaces bearer token auth entirely. The server extracts the authenticated user's email from the JWT.

## Security Notes

- **API keys are encrypted at rest** with AES-256-GCM using the `OPENMGR_ENCRYPTION_KEY`
- **Bearer tokens** should be treated as secrets — never commit them to version control
- **The agent has filesystem access** within project workspaces — review the workspace directory permissions
- **Webhook endpoints** (e.g., `/channels/slack/events`) do not require bearer token auth but verify signatures from the originating platform

## Monitoring

### Health Check

```bash
curl http://localhost:6647/health
```

Returns `200 OK` when the server is healthy. Use this endpoint for load balancer health checks.

### Logging

Control log verbosity with the `LOG_LEVEL` environment variable:

```bash
LOG_LEVEL=debug  # Maximum verbosity
LOG_LEVEL=info   # Default — normal operation
LOG_LEVEL=warn   # Warnings and errors only
LOG_LEVEL=error  # Errors only
```

## Backup

The critical data to back up:

| Data | Location | Description |
|------|----------|-------------|
| SQLite database | `OPENMGR_DATA_DIR` (default: `~/.config/openmgr-server/`) | All server state — projects, sessions, channels, etc. |
| Workspaces | `OPENMGR_WORKSPACES_DIR` (default: `~/openmgr/`) | Project files and agent outputs |
| Encryption key | `OPENMGR_ENCRYPTION_KEY` | Required to decrypt stored API keys |

:::caution
If you lose the encryption key, all stored provider API keys become unrecoverable. Store it securely (e.g., in a secrets manager).
:::
