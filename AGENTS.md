# Agent Instructions

## Overview

OpenMgr is a pnpm + Turborepo monorepo. All packages compile TypeScript to `dist/` directories.

## Repository Layout

```
apps/server/          Hono HTTP server (SQLite + Drizzle)
apps/desktop/         Electron desktop app
apps/mobile/          React Native / Expo mobile app
packages/core/        Agent framework (orchestrator, plugins, MCP, tools)
packages/providers/   LLM providers (Anthropic, OpenAI, Google, etc.)
packages/cli/         CLI
packages/server/      Embeddable agent HTTP server
packages/ui/          Shared React components (cross-platform)
packages/tools/       Platform-agnostic tools
packages/tools-terminal/  Terminal/filesystem tools (Node.js)
packages/docker/      Docker container management (shared)
packages/agent-worktree/  Git worktree management (shared)
packages/database/    SQLite adapter (better-sqlite3)
packages/database-core/  Database interface and schema
packages/storage/     Session persistence
packages/memory/      Vector memory
packages/server-ui/   Server web UI (React + Vite)
tests/                E2E, integration, and scenario tests
```

## Building

All packages must be built before runtime use. Source changes are not picked up until rebuilt.

```bash
pnpm build                                    # Build everything (via Turborepo)
pnpm turbo build --filter=@openmgr/server     # Build one package + its deps
```

The `apps/server/` build script uses `;` (not `&&`) because tsc has pre-existing type errors but still emits JS. The server has its own standalone tsconfig (not extending the base).

UI packages (`@openmgr/ui`, `@openmgr/server-ui`) export TypeScript source directly and are consumed by bundlers (Vite/Metro) — they do not need a separate build step for dev.

## Testing

```bash
pnpm -r test --no-bail                        # All tests across all packages
cd packages/core && pnpm test                 # Single package
```

### Conventions

- Test files: `src/__tests__/*.test.ts` (packages) or colocated `*.test.ts` (server)
- Uses `vitest` — most packages use `globals: false` (import `describe`, `it`, `expect` from `vitest`), server uses `globals: true`
- The `ui` package uses jsdom environment with react and react-native-web
- `tools-director` has `--passWithNoTests` (no test files)

## Key Architecture Details

### Agent Core (`packages/core/`)

Central `Agent` class orchestrates LLM communication, tool execution, plugins, MCP servers, and conversation management. Five registries (Tool, Provider, Command, AgentType, Capability) are instance-scoped with global singleton defaults. See `packages/core/` for the full architecture doc.

### Server (`apps/server/`)

Hono HTTP server with SQLite (better-sqlite3) + Drizzle ORM. Service container pattern — `createServices(config, db)` wires all services via DI. Route files export functions that register on a Hono app. See `apps/server/AGENTS.md` for detailed instructions.

### Cross-Platform UI (`packages/ui/`)

React components shared between desktop (react-dom via react-native-web) and mobile (React Native). Uses react-native-web for cross-platform primitives. Path aliases in desktop (`electron.vite.config.ts`) and mobile (`jest.config.js`) point `@openmgr/ui` to the source directory.

**Color palette**: `packages/ui/src/styles/tokens.ts` is the single source of truth for all colors across every UI surface (desktop, mobile, server-ui). See `packages/ui/AGENTS.md` for the full palette reference. Never hardcode hex color values in UI components.

### Server UI (`packages/server-ui/`)

Separate React + Vite SPA for the server's web interface. Built to `dist/` and consumed by `apps/server/` — the server copies the built UI during its own build (`cp -r node_modules/@openmgr/server-ui/dist dist/ui`). Colors are CSS custom properties mirrored from `packages/ui/src/styles/tokens.ts` — see `packages/server-ui/AGENTS.md`.

### Module Resolution

- Agent packages (packages/*): `module: NodeNext`, `moduleResolution: NodeNext`
- App packages (apps/*, ui, server-ui): `module: ESNext`, `moduleResolution: bundler`, `verbatimModuleSyntax: false`
- Base config: `tsconfig.base.json` (NodeNext, strict, ES2022)
- Server has standalone tsconfig (not extending base)

### Dependencies

- All `@openmgr/*` deps use `workspace:*`
- pnpm strict mode — packages must declare all their direct dependencies
- React versions pinned via pnpm overrides in root `package.json`

## CI / GitHub Actions

- `.github/actions/setup/` — composite action for checkout, pnpm, Node, install, build
- `ci.yml` — test (Node 20/22 matrix), lint, coverage (push/PR)
- `e2e-desktop.yml` — Playwright E2E on macOS (push/PR)
- `docs.yml` — build/deploy documentation to GitHub Pages (push to `docs/`, release, manual)

## Releasing

Releases are done locally using scripts in `scripts/`. There are no CI workflows for building release artifacts — everything runs on your machine.

### Quick start

```bash
./scripts/release.sh v1.0.0
```

This single command orchestrates the full release:
1. Validates prerequisites (clean git tree, `gh` auth, Docker running)
2. Creates a **draft** GitHub Release with auto-generated notes
3. Builds Electron apps for macOS, Linux, and Windows
4. Uploads Electron artifacts (`.dmg`, `.zip`, `.exe`, `.AppImage`, `.deb`, etc.) to the release
5. Builds and pushes Docker images (`full` + `lite`, `linux/amd64` + `linux/arm64`) to GHCR and Docker Hub
6. Publishes (undrafts) the GitHub Release

### Individual scripts

| Script | pnpm alias | Description |
|--------|-----------|-------------|
| `scripts/release.sh <version>` | `pnpm release <version>` | Full release orchestrator |
| `scripts/build-electron.sh <version>` | `pnpm release:electron <version>` | Build Electron for all platforms |
| `scripts/build-docker.sh <version>` | `pnpm release:docker <version>` | Build + push Docker images |
| `scripts/upload-release-assets.sh <version>` | `pnpm release:upload <version>` | Upload Electron artifacts to a GitHub Release |

### Environment variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `SKIP_ELECTRON` | `release.sh` | Set to `true` to skip Electron builds |
| `SKIP_DOCKER` | `release.sh` | Set to `true` to skip Docker builds |
| `SKIP_PUSH` | `build-docker.sh` | Set to `true` to build Docker images without pushing |
| `DOCKER_PLATFORMS` | `build-docker.sh` | Override platforms (default: `linux/amd64,linux/arm64`) |
| `CSC_LINK` | `build-electron.sh` | macOS code signing certificate (base64 .p12) |
| `CSC_KEY_PASSWORD` | `build-electron.sh` | macOS certificate password |
| `APPLE_ID` | `build-electron.sh` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | `build-electron.sh` | App-specific password for notarization |
| `APPLE_TEAM_ID` | `build-electron.sh` | Apple Developer Team ID |

### Prerequisites

- **gh CLI**: authenticated (`gh auth login`)
- **Docker**: running with buildx support, logged in to GHCR (`docker login ghcr.io`) and Docker Hub (`docker login`)
- **QEMU**: for cross-arch Docker builds (the script registers it automatically via `multiarch/qemu-user-static`)
- **Code signing** (optional): set the macOS/Windows env vars above for signed builds

## Docker Image Variants

The Dockerfile (`apps/server/Dockerfile`) supports a `VARIANT` build arg (`full` or `lite`).

| Variant | Tag examples | Description |
|---------|-------------|-------------|
| `full` (default) | `latest`, `1.2.3` | All features including Playwright/Chromium browser tools and ML embedding-based vector memory. |
| `lite` | `lite`, `1.2.3-lite` | Stripped of Playwright/Chromium (~300-500 MB) and onnxruntime/huggingface ML deps (~50-150 MB). Agents lose `browser_*` tools and fall back to keyword-only memory search. |

### Local commands

```bash
pnpm docker:build                  # Build full image (openmgr/server:local)
pnpm docker:build:lite             # Build lite image (openmgr/server:local-lite)
pnpm docker:run                    # Run full image
pnpm docker:run:lite               # Run lite image
pnpm compose:up:lite               # Compose up with lite variant
pnpm compose:up:lite:detached      # Compose up (detached) with lite variant
```

### Graceful degradation

Code that depends on stripped dependencies uses dynamic `import()` with try/catch:
- `packages/node/src/index.ts` — browser-sandbox loaded lazily via `loadBrowserSandbox()`; `createNodeAgent()` skips browser plugin registration if unavailable.
- `packages/agent/src/index.ts` — memory re-exported as types only; `loadMemoryModule()` helper for runtime access.
- `packages/cli/src/commands/serve.ts` — `memoryPlugin` loaded with try/catch; logs a message and continues without it.
- `apps/server/src/routes/memories.ts` and `apps/desktop/` — already used dynamic imports with fallbacks before the lite variant was introduced.

## TODOs

- **App store URLs**: The "Connect App" section on the server settings page (`packages/server-ui/src/pages/SettingsPage.tsx`) uses placeholder app store URLs (`https://apps.apple.com/app/openmgr`, `https://play.google.com/store/apps/details?id=com.openmgr`). Replace these with real URLs once the apps are published.
- **Docker agent spawning**: `DockerManager` has been extracted to `packages/docker/` (`@openmgr/agent-docker`). The server re-exports it from `apps/server/src/services/docker-manager.ts`. The desktop has `LocalDockerService` for local Docker support. Agent processes are currently spawned as local Node.js child processes; Docker-based spawning works per-project (one container per project). Per-worktree Docker containers are a future enhancement — the lifecycle hooks in `ProjectWorktreeManager.setHooks()` provide the integration point. When running outside Docker, the agent image defaults to `openmgr/server:latest` — in the future this should default to the matching release version.
- **Dead `buildDockerImage` code**: `AgentBridge.buildDockerImage`, the desktop bridge implementation, and the "Build Agent Image" button in `DockerSettings.tsx` are dead code — no server endpoint exists. Remove from `AgentBridge` type, `desktopBridge.ts`, `ipc.ts`, `preload/index.ts`, and `DockerSettings.tsx`.
- **projectTemplates unused columns**: Five columns in the `projectTemplates` schema (`setupCommands`, `fileTemplates`, `rootAgentType`, `agentTypes`, `hubTemplateId`) are defined but not yet implemented. See comments in `apps/server/src/db/schema.ts`.

## Common Pitfalls

- **Cyclic deps**: `@openmgr/agent-core` cannot depend on `@openmgr/agent-providers` (even as devDep). Tests in core use mocks.
- **Missing direct deps**: pnpm strict mode does not hoist. If a package imports something, it must be in its own `package.json`.
- **Test files in builds**: tsconfig `include: ["src/**/*"]` without excluding `__tests__/` will cause build failures when test files import vitest. Add `"exclude": ["src/**/__tests__/**"]`.
- **Server tsconfig**: Do not extend `tsconfig.base.json` — the base config enables `noUncheckedIndexedAccess` and `verbatimModuleSyntax` which surface many pre-existing server type errors.
- **Rebuilt before runtime**: The server spawns agent processes from `packages/cli/dist/bin.js`. Source changes to any `@openmgr/*` package require `pnpm build` and restarting the server.
