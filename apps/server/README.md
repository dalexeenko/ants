# Ants Server

Self-hosted server for managing AI coding agents. Provides a REST API and web UI for creating projects, running agent sessions, scheduling tasks, and integrating with messaging platforms like Slack.

Designed to be deployed on your own infrastructure - no external services required.

## Quick Start

### Option 1: npx (fastest)

```bash
npx @ants/server
```

### Option 2: Global Install

```bash
npm install -g @ants/server
ants-server
```

### Option 3: Docker

```bash
docker run -p 6647:6647 \
  -v ants-data:/data \
  -v ants-workspaces:/workspaces \
  -e ANTS_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  ants/server
```

### Option 4: Docker Compose

```bash
git clone https://github.com/ants/server.git
cd server
docker compose up
```

On startup, the server prints a bearer token to the console. Use this token to authenticate with the [Ants App](https://github.com/ants/app) or API calls.

## Configuration

Configuration is via environment variables. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### Required

| Variable | Description |
|----------|-------------|
| `ANTS_ENCRYPTION_KEY` | 32-byte base64 key for encrypting stored credentials. Generate with: `openssl rand -base64 32` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTS_PORT` | `6647` | Port to listen on |
| `ANTS_HOST` | `127.0.0.1` | Bind address |
| `ANTS_SECRET` | Auto-generated | Bearer token for authentication |
| `ANTS_DATA_DIR` | `~/.config/ants-server/` | Server data directory |
| `ANTS_WORKSPACES_DIR` | `~/ants/` | Project workspace directory |
| `ANTS_AGENT_PATH` | Auto-detected | Path to the Ants Agent binary |
| `ANTS_AUTO_INSTALL_AGENT` | `true` | Auto-install agent if not found |
| `ANTS_MULTI_USER` | `false` | Enable multi-user mode with RBAC |
| `ANTS_CORS_ORIGINS` | | Comma-separated allowed CORS origins |
| `ANTS_MOCK_AGENT` | `false` | Use mock agent for testing |

### Cloudflare Access (Optional)

When both variables are set, Cloudflare Access JWT validation replaces bearer token auth:

| Variable | Description |
|----------|-------------|
| `ANTS_CF_ACCESS_TEAM_DOMAIN` | Your team domain (e.g., `https://myteam.cloudflareaccess.com`) |
| `ANTS_CF_ACCESS_AUD` | Application Audience tag from your Access app config |
| `ANTS_CF_ACCESS_SET_IDENTITY` | Extract email from CF JWT as request identity (default: `true`) |

## Authentication

The server uses Bearer token auth. Include the token in every request:

```
Authorization: Bearer <your-token>
```

The token is printed to the console on startup. If `ANTS_SECRET` is set, the token is deterministically derived from it.

### Multi-User Mode

Set `ANTS_MULTI_USER=true` to enable user accounts with role-based access control:

- **Admin** - Full access, user management
- **Operator** - Create/manage projects and sessions
- **Viewer** - Read-only access

Supports local password auth and social OAuth (Google, GitHub, Microsoft).

## LLM Providers

Configure API keys through the web UI or API. Supported providers:

- **Anthropic** - Claude models
- **OpenAI** - GPT models
- **Google** - Gemini models
- **OpenRouter** - Multi-model gateway
- **Groq** - Fast inference
- **xAI** - Grok models
- AWS Bedrock, Azure OpenAI, Google Vertex, Mistral, Cohere, Together, Fireworks, DeepSeek

API keys are encrypted at rest with AES-256-GCM.

## Web UI

The server includes a built-in web UI at `http://localhost:6647` for managing projects, viewing sessions, and configuring settings. For a full-featured experience, use the [Ants App](https://github.com/ants/app).

## API Overview

All endpoints (except health/webhooks) require Bearer token auth.

### Projects
- `GET /projects` - List projects
- `POST /projects` - Create project
- `GET /projects/:id` - Get project
- `PATCH /projects/:id` - Update project
- `DELETE /projects/:id` - Delete project
- `POST /projects/:id/restart` - Restart agent server

### Sessions
- `POST /projects/:id/sessions` - Create session
- `GET /projects/:id/sessions/:sid` - Get session
- `DELETE /projects/:id/sessions/:sid` - Delete session
- `GET /projects/:id/sessions/:sid/messages` - Get messages
- `POST /projects/:id/sessions/:sid/prompt` - Send prompt
- `POST /projects/:id/sessions/:sid/abort` - Abort running prompt

### Files
- `GET /projects/:id/files` - List files
- `GET /projects/:id/files/content` - Read file
- `PUT /projects/:id/files/content` - Write file
- `POST /projects/:id/files/directory` - Create directory
- `DELETE /projects/:id/files` - Delete file

### Terminals
- `POST /projects/:id/terminals` - Create terminal
- `GET /projects/:id/terminals/:tid/ws` - WebSocket I/O

### Tasks (Scheduled)
- `GET /projects/:id/tasks` - List tasks
- `POST /projects/:id/tasks` - Create task
- `POST /projects/:id/tasks/:tid/run` - Run immediately

### Channels (Messaging Integrations)
- `POST /channels` - Create channel (Slack, Discord, Telegram)
- `POST /channels/:id/bindings` - Bind channel to project

### System
- `GET /health` - Health check (no auth)
- `GET /system/agent` - Agent installation status
- `PUT /system/api-keys/:provider` - Set provider API key

## Deploying to Production

For production deployments:

1. **Set a strong encryption key** - `openssl rand -base64 32`
2. **Use a reverse proxy** - Put nginx or Caddy in front for TLS termination
3. **Set `ANTS_HOST=0.0.0.0`** - To listen on all interfaces
4. **Set `ANTS_SECRET`** - For a stable, known bearer token
5. **Configure CORS** - Set `ANTS_CORS_ORIGINS` for your app domains

Example with Docker:

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

## Development

### Prerequisites

- Node.js >= 18.0.0
- pnpm

### Setup

```bash
git clone https://github.com/ants/server.git
cd server
pnpm install

# Link agent packages for local development
./scripts/link-agent.sh

# Start with hot reload
pnpm dev
```

### Testing

```bash
pnpm test
```

### Building

```bash
pnpm build
```

## License

MIT
