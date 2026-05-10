# OpenMgr

Open-source platform for managing AI coding agents. Includes a self-hosted server, desktop app (Electron), mobile app (React Native), and a modular agent framework.

## Repository Structure

```
apps/
  server/        Self-hosted management server (Hono + SQLite)
  desktop/       Desktop app (Electron)
  mobile/        Mobile app (React Native / Expo)

packages/
  core/          Agent framework core (orchestrator, plugins, MCP, tools)
  providers/     LLM provider adapters (Anthropic, OpenAI, Google, etc.)
  cli/           Command-line interface
  server/        Embeddable HTTP server for the agent
  ui/            Shared React UI components (cross-platform)
  tools/         Platform-agnostic agent tools
  tools-terminal/  Terminal/filesystem tools (Node.js)
  tools-director/  Director-mode tools
  database/      SQLite database adapter (better-sqlite3)
  database-core/ Database interface and schema
  storage/       Session persistence
  memory/        Vector memory / knowledge base
  skills-content/ Bundled skill content
  skills-loader/ Filesystem skill loader
  scheduler/     Task scheduling
  ...            See packages/ for the full list

tests/
  agent-e2e-tests/         CLI and HTTP server E2E tests
  agent-integration-tests/ Plugin and skill integration tests
  app-integration-tests/   Server API integration tests
  test-scenarios/          Shared E2E scenarios (generates Playwright + Maestro)
```

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm 9

### Setup

```bash
git clone https://github.com/openmgr/openmgr.git
cd openmgr
pnpm install
pnpm build
```

### Run the Server

```bash
cd apps/server
pnpm dev
```

### Run the Desktop App

```bash
cd apps/desktop
pnpm dev
```

### Run the Mobile App

```bash
cd apps/mobile
npx expo start
```

## Development

### Build

Turborepo handles build ordering across all packages:

```bash
pnpm build              # Build everything
pnpm turbo build --filter=@openmgr/server  # Build one package + deps
```

### Test

```bash
pnpm -r test --no-bail  # Run all tests across all packages
pnpm test --filter=packages/core  # Run tests for a specific package
```

### Watch Mode

```bash
pnpm dev                # Watch mode for all packages
```

### Lint

```bash
pnpm lint
```

## Docker

Build and run the server as a Docker container:

```bash
docker run -p 6647:6647 \
  -v openmgr-data:/data \
  -v openmgr-workspaces:/workspaces \
  -e OPENMGR_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  openmgr/server
```

Or with Docker Compose:

```bash
cd apps/server
docker compose up
```

## License

MIT
