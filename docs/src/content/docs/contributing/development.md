---
title: Development Setup
description: Set up the OpenMgr monorepo for local development — building, testing, and running.
sidebar:
  order: 1
---

## Prerequisites

- **Node.js** >= 20
- **pnpm** 9

## Clone and Install

```bash
git clone https://github.com/openmgr/openmgr.git
cd openmgr
pnpm install
```

## Build

Turborepo handles build ordering across all packages:

```bash
# Build everything
pnpm build

# Build a specific package and its dependencies
pnpm turbo build --filter=@openmgr/server
```

:::note
The `apps/server/` build script uses `;` (not `&&`) because TypeScript has pre-existing type errors but still emits JavaScript. The build completes successfully despite type warnings.
:::

All `@openmgr/*` packages compile TypeScript to `dist/` directories. **Source changes are not picked up until rebuilt.**

## Run

### Server

```bash
cd apps/server
pnpm dev
```

### Desktop App

```bash
cd apps/desktop
pnpm dev
```

### Mobile App

```bash
cd apps/mobile
npx expo start
```

## Test

```bash
# Run all tests across all packages
pnpm -r test --no-bail

# Run tests for a specific package
cd packages/core && pnpm test
```

### Test Conventions

- Test files: `src/__tests__/*.test.ts` (packages) or colocated `*.test.ts` (server)
- Framework: `vitest` — most packages use `globals: false` (import from `vitest`), server uses `globals: true`
- The `ui` package uses jsdom environment with react-native-web

## Watch Mode

```bash
pnpm dev    # Watch mode for all packages
```

## Lint

```bash
pnpm lint
```

## Repository Structure

```
apps/
  server/          Self-hosted management server (Hono + SQLite)
  desktop/         Desktop app (Electron)
  mobile/          Mobile app (React Native / Expo)

packages/
  core/            Agent framework core
  providers/       LLM provider adapters
  cli/             Command-line interface
  server/          Embeddable HTTP server for the agent
  ui/              Shared React UI components
  tools/           Platform-agnostic agent tools
  tools-terminal/  Terminal/filesystem tools
  database/        SQLite database adapter
  database-core/   Database interface and schema
  storage/         Session persistence
  memory/          Vector memory
  server-ui/       Server web UI (React + Vite)
  ...              See packages/ for the full list

tests/
  agent-e2e-tests/         CLI and HTTP server E2E tests
  agent-integration-tests/ Plugin and skill integration tests
  app-integration-tests/   Server API integration tests
  test-scenarios/          Shared E2E scenarios

deploy/
  aws/terraform/   AWS ECS Fargate deployment

docs/              Documentation site (Starlight / Astro)
```

## Common Pitfalls

- **Cyclic dependencies** — `@openmgr/agent-core` cannot depend on `@openmgr/agent-providers`. Tests in core use mocks.
- **Missing direct dependencies** — pnpm strict mode doesn't hoist. If a package imports something, it must be in its own `package.json`.
- **Test files in builds** — tsconfig `include: ["src/**/*"]` without excluding `__tests__/` will cause build failures when test files import vitest. Add `"exclude": ["src/**/__tests__/**"]`.
- **Server tsconfig** — The server has its own standalone tsconfig. Do not extend `tsconfig.base.json`.
- **Rebuild before testing runtime** — The server spawns agent processes from `packages/cli/dist/bin.js`. Source changes require `pnpm build` and a server restart.

## Module Resolution

| Package Type | Module | Resolution |
|-------------|--------|------------|
| Agent packages (`packages/*`) | `NodeNext` | `NodeNext` |
| App packages (`apps/*`, `ui`, `server-ui`) | `ESNext` | `bundler` |
| Base config | `tsconfig.base.json` | NodeNext, strict, ES2022 |
| Server | Standalone | Not extending base |

## Dependencies

- All `@openmgr/*` dependencies use `workspace:*`
- React versions are pinned via pnpm overrides in root `package.json`
