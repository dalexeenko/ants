---
title: Architecture Deep Dive
description: Detailed architecture reference for OpenMgr contributors — server internals, agent framework, and cross-platform UI.
sidebar:
  order: 2
---

This page covers the internal architecture in detail for contributors.

## Server Internals

### Entry Point

`apps/server/src/index.ts` — Creates the Hono app, loads config, bootstraps services, registers routes, starts background services, and prints the startup banner.

### Service Container

`src/services/container.ts` — `createServices(config, db)` creates all service instances with dependency injection and returns a `Services` object. No global state; all services are wired here and passed to routes.

### Route Files

Each route file exports a function `(app, services)` that registers routes on the Hono app:

| File | Description |
|------|-------------|
| `sessions.ts` | Session CRUD (426 lines) |
| `session-streaming.ts` | Session SSE streaming (392 lines) |
| `projects.ts` | Project management |
| `providers.ts` | Provider credential management |
| `tasks.ts` | Task scheduling |
| `tools.ts` | Tool management |
| `plugins.ts` | Plugin management |
| `terminals.ts` | Terminal sessions |
| `channels.ts` | Messaging channels |
| `webhooks.ts` | Webhook management |
| `files.ts` | File operations |
| `filesystem.ts` | Filesystem browsing |
| `search.ts` | Search |
| `analytics.ts` | Usage analytics |
| `approvals.ts` | Human-in-the-loop approvals |
| `notifications.ts` | Push notifications |
| `templates.ts` | Session templates |
| `agent-comms.ts` | Agent communication |
| `users.ts` | User management |
| `health.ts` | Health check |
| `system.ts` | System info |

### Database

- **Schema**: `src/db/schema.ts` — 23 Drizzle table definitions
- **Migrations**: `src/db/migrations/` — managed by `drizzle-kit`
- **Database service**: `src/db/index.ts` — wraps better-sqlite3 + Drizzle
- **Legacy support**: `stampLegacyDatabase()` detects pre-Drizzle databases and seeds the migration journal

### Validation

- All request bodies validated with **Zod v4** schemas in `src/schemas/index.ts`
- `parseBody(c, schema)` validates JSON body, throws `ValidationError` (HTTP 400) on failure
- Per-field error messages via `formatIssue()`

### Provider Credentials

- `ApiKeyManager` in `src/services/api-key-manager.ts`
- Encrypted AES-256-GCM storage in SQLite
- Legacy `providers.json` automatically migrated on first startup

### Background Services

Started in `index.ts` after route registration:

- `taskScheduler` — Runs scheduled tasks
- `messageProcessor` — Processes channel message queue
- `agentComms` — Agent process communication
- `webhookManager` — Webhook delivery
- `approvalManager` — Approval lifecycle
- `fileWatcherManager` — File change detection
- `channelManager` — Channel adapter lifecycle

## Agent Framework Internals

### Core Package (`packages/core/`)

The `Agent` class orchestrates:

1. **Message preparation** — System prompt + conversation history + tool descriptions
2. **LLM request** — Send to the configured provider
3. **Tool execution loop** — Execute tool calls, feed results back, repeat until text response
4. **Response streaming** — Stream incremental updates back to the caller
5. **Session persistence** — Store conversation history

### Provider Adapters (`packages/providers/`)

Each provider adapter normalizes the LLM API into a common interface:

- Request format conversion (messages, tools, parameters)
- Response streaming normalization
- Error handling and retry logic
- Token counting and usage tracking

## Cross-Platform UI

### Shared Components (`packages/ui/`)

React components shared between desktop (react-dom via react-native-web) and mobile (React Native):

- Uses react-native-web for cross-platform primitives
- Color palette defined in `src/styles/tokens.ts` — single source of truth for all colors
- Path aliases in desktop (`electron.vite.config.ts`) and mobile (`jest.config.js`) point `@openmgr/ui` to the source directory

### Server UI (`packages/server-ui/`)

Separate React + Vite SPA for the server's web interface:

- Built to `dist/` and consumed by `apps/server/`
- Server copies the built UI during build: `cp -r node_modules/@openmgr/server-ui/dist dist/ui`
- Colors are CSS custom properties mirrored from `packages/ui/src/styles/tokens.ts`

## CI / GitHub Actions

| Workflow | Trigger | Description |
|----------|---------|-------------|
| `ci.yml` | Push/PR | Tests (Node 20/22 matrix), lint, coverage |
| `e2e-desktop.yml` | Push/PR | Playwright E2E on macOS |
| `docker.yml` | Release | Docker build + push (full and lite variants) to GHCR and Docker Hub |
| `electron-build.yml` | Release | Electron packaging for macOS/Linux/Windows |
