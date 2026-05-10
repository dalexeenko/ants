# Agent Instructions for @ants/server

## Overview

Hono HTTP server with SQLite (better-sqlite3) + Drizzle ORM. Lives at `apps/server/` in the Ants monorepo.

## Architecture

### Entry Point

`src/index.ts` (152 lines) — creates the Hono app, loads config, bootstraps services, registers routes, starts background services, and prints the startup banner.

### Service Container

`src/services/container.ts` — `createServices(config, db)` creates all service instances with dependency injection and returns a `Services` object. No global state; all services are wired here and passed to routes.

### Route Registration

`src/routes/index.ts` — `registerRoutes(app, config, services, upgradeWebSocket)` registers all route groups on the Hono app.

### Route Files

Each route file exports a function `(app, services)` that registers routes on a Hono app:

| File | Description |
|------|-------------|
| `sessions.ts` (426 lines) | Session CRUD |
| `session-streaming.ts` (392 lines) | Session SSE streaming (separated from CRUD) |
| `projects.ts` | Project management |
| `providers.ts` | Provider credential management |
| `tasks.ts` | Task scheduling |
| `tools.ts` | Tool management |
| `plugins.ts` | Plugin management |
| `terminals.ts` | Terminal sessions |
| `channels.ts` | Messaging channels (Slack, Discord, Telegram) |
| `webhooks.ts` | Webhook management |
| `files.ts` | File operations |
| `filesystem.ts` | Filesystem browsing |
| `search.ts` | Search |
| `analytics.ts` | Usage analytics |
| `approvals.ts` | Human-in-the-loop approvals |
| `notifications.ts` | Push notifications |
| `templates.ts` | Session templates |
| `agent-comms.ts` | Agent communication |
| `users.ts` | User management (multi-user mode) |
| `health.ts` | Health check |
| `system.ts` | System info |

## Database

- **Schema**: `src/db/schema.ts` — Drizzle schema definitions (23 tables)
- **Migrations**: `src/db/migrations/` — managed by `drizzle-kit`
- **Config**: `drizzle.config.ts` at repo root
- **Database service**: `src/db/index.ts` — `DatabaseService` class wraps better-sqlite3 + Drizzle
- **Legacy DB support**: `stampLegacyDatabase()` in `src/db/index.ts` detects pre-drizzle databases (projects table exists but `__drizzle_migrations` does not) and seeds the migration journal so the initial migration is not re-applied
- **Build step copies migrations**: `"build": "tsc; cp -r src/db/migrations dist/db/migrations"` — uses `;` (not `&&`) because tsc has pre-existing type errors but still emits JS; the migrations must be in dist/ at runtime

## Validation

- All request bodies validated with **Zod v4** schemas in `src/schemas/index.ts` (500+ lines)
- Helper functions in `src/utils/validation.ts`:
  - `parseBody(c, schema)` — parse and validate JSON body, throws `ValidationError` (HTTPException 400) on failure
  - `parseBodyOptional(c, schema)` — same but returns `undefined` for empty body
  - `ValidationError` — extends `HTTPException`, returns JSON `{ error: string }`
- `formatIssue()` produces user-friendly per-field error messages (e.g. "name is required")
- **Zod v4 bug**: use `z.record(z.string(), z.unknown())` not `z.record(z.unknown())`

## Logging

- Structured logger: `src/utils/logger.ts`
- `createLogger(module)` returns `{ debug, info, warn, error, child }`
- Log level controlled by `LOG_LEVEL` env var (default: `"info"`)
- `setLogLevel(level)` for runtime override (useful in tests)
- `banner()` function for startup output (always prints regardless of level)
- All source files use the logger instead of `console.*` (except `config.ts` fatal errors which use `console.error` + `process.exit`)

## Provider Credentials

- Single system: `ApiKeyManager` in `src/services/api-key-manager.ts`
- Encrypted AES-256-GCM storage in SQLite
- 14 supported providers: anthropic, openai, google, openrouter, groq, xai, aws-bedrock, azure-openai, google-vertex, mistral, cohere, together, fireworks, deepseek
- Legacy `providers.json` automatically migrated on first startup via `migrateLegacyProviders()` in `container.ts`
- Legacy `ProviderCredentialsService` has been removed

## Testing

### Running Tests

```bash
pnpm test
```

### Conventions

- Uses `vitest` with `globals: true` — no need to import `describe`, `it`, `expect`
- Shared test helper: `src/test-utils/db.ts` — `createTestDatabase()` creates an in-memory SQLite database with full schema applied via Drizzle migrations
- Test files are colocated with source: `src/routes/*.test.ts`, `src/services/*.test.ts`, `src/utils/*.test.ts`
- 918 tests across 40 test files

## Local Development Setup

This server depends on several `@ants/agent-*` packages that live in `packages/` within the same monorepo. pnpm workspace linking handles all dependency resolution automatically — no linking scripts needed.

## Build After Modifications

The server compiles TypeScript to `dist/`. You must rebuild after modifying any source file:

```bash
# From the monorepo root
pnpm turbo build --filter=@ants/server

# Or rebuild everything
pnpm turbo build --force
```

If you modify any `@ants/agent-*` package source, Turborepo will rebuild dependencies automatically when you build the server.

After rebuilding, restart the ants server and kill any running agent-server child processes so they pick up the new code.

## Key Conventions

- Route files export a function `(app, services)` that registers routes on a Hono app
- Services are created in `container.ts` and passed to routes — no global state
- Session streaming is split from CRUD: `sessions.ts` (426 lines) + `session-streaming.ts` (392 lines)
- **Zod v4 bug**: use `z.record(z.string(), z.unknown())` not `z.record(z.unknown())`
- All errors should use the structured logger, not `console.*`
- Background services (`taskScheduler`, `messageProcessor`, `agentComms`, `webhookManager`, `approvalManager`, `fileWatcherManager`, `channelManager`) are started in `index.ts` after route registration
