# Agents

Operational guide for AI agents working in this repository.

Ants is an AI agent platform — TypeScript monorepo, React + Vite frontend, Hono + SQLite backend, Docker + git worktree sandboxing. ~25 packages built with pnpm workspaces and Turborepo.

---

## Commands

```bash
# Build
pnpm build                                      # Build everything (Turborepo handles order)
pnpm turbo build --filter=@ants/server          # Build one package + its deps
pnpm turbo build --filter=@ants/agent-verifiers # Build a specific package

# Dev
pnpm dev                                        # Watch mode — all packages
pnpm dev:server                                 # Server only (apps/server)
pnpm dev:desktop                                # Desktop app (apps/desktop)

# Test
pnpm test                                       # All tests across all packages
pnpm -r test --no-bail                          # Same, don't stop on first failure
pnpm --filter @ants/agent-verifiers test        # Single package
cd packages/core && pnpm test                   # Single package (cd form)

# Lint
pnpm lint

# Release (local — no CI)
./scripts/release.sh v1.2.3                     # Full release: Electron + Docker + GitHub
./scripts/build-electron.sh v1.2.3             # Electron only
./scripts/build-docker.sh v1.2.3               # Docker only
```

**Important:** All `@ants/*` packages compile TypeScript to `dist/`. Source changes are not picked up at runtime until rebuilt. The server spawns agent processes from `packages/cli/dist/bin.js` — always rebuild after changes.

### Test conventions

- Test files: `src/__tests__/*.test.ts` in packages, colocated `*.test.ts` in apps/server
- Framework: Vitest with `globals: false` (import `describe`, `it`, `expect` from `'vitest'`)
- Exception: `apps/server` uses `globals: true`
- UI package uses jsdom environment with react-native-web

---

## Deployment

### Docker (recommended for teams)

```bash
docker run -p 6647:6647 \
  -v ants-data:/data \
  -v ants-workspaces:/workspaces \
  -e ANTS_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  ants/server
```

```bash
cd apps/server && docker compose up             # Docker Compose
```

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTS_ENCRYPTION_KEY` | **Yes** | — | 32-byte base64 key for encrypting stored credentials |
| `ANTS_SECRET` | No | auto-generated | Bearer token for single-user auth |
| `ANTS_PORT` | No | `6647` | Server port |
| `ANTS_HOST` | No | `127.0.0.1` | Bind address |
| `ANTS_DATA_DIR` | No | `~/.config/ants-server` | SQLite + config storage |
| `ANTS_WORKSPACES_DIR` | No | `~/ants` | Agent workspace root |
| `ANTS_MULTI_USER` | No | `false` | Enable RBAC multi-user mode |
| `ANTS_WEB_APP` | No | `false` | Serve web UI at `/app` |
| `ANTS_SETUP_TOKEN` | No | — | One-time token to claim initial admin |
| `ANTS_CF_ACCESS_TEAM_DOMAIN` | No | — | Cloudflare Access team domain |
| `ANTS_CF_ACCESS_AUD` | No | — | Cloudflare Access AUD tag |
| `ANTS_ALLOWED_HOSTS` | No | `localhost` | Comma-separated allowed Host headers |
| `ANTS_SQLITE_JOURNAL_MODE` | No | `wal` | Use `delete` on network filesystems (EFS) |

### Docker image variants

| Variant | Tag | Includes |
|---|---|---|
| `full` (default) | `latest`, `1.2.3` | Playwright/Chromium browser tools + ONNX ML embeddings |
| `lite` | `lite`, `1.2.3-lite` | No browser tools, no ML — keyword-only memory search |

---

## Sandbox Isolation and Lifecycle

Each **project** is the unit of isolation. Every project gets:

| Resource | Implementation | Location |
|---|---|---|
| Conversation | Persistent session history, context compaction, branching | SQLite via Drizzle ORM |
| Sandbox | Docker container **or** git worktree (per project config) | `packages/docker`, `packages/agent-worktree` |
| Tools | bash, read/write/edit, browser, LSP, MCP plugins | `packages/tools-terminal`, `packages/browser-core` |
| State | SQLite DB + semantic memory with local ONNX embeddings | `packages/database`, `packages/memory` |

### Sandbox modes

**Git worktrees** — default for local dev. Each session or project gets an isolated branch checked out in a separate directory. No container overhead; fast startup.

**Docker containers** — one container per project. Configured via `DockerManager` (`packages/docker`). The server spawns agent processes as Node.js child processes inside or alongside containers. Per-worktree containers are a planned enhancement — the integration point is `ProjectWorktreeManager.setHooks()`.

### Lifecycle

```
Project created
  → SQLite row in `projects` table
  → workspace directory allocated under ANTS_WORKSPACES_DIR
  → agent process spawned (packages/cli/dist/bin.js)
  → session created (conversation history)
  → tools and MCP plugins loaded
  → Docker container started (if docker mode)

Project deleted
  → agent process killed
  → Docker container stopped and removed
  → worktrees cleaned up
  → SQLite rows deleted (cascade)
```

---

## Context Library

Skills live in `packages/skills-loader/skills/`. Each skill is a directory with a `SKILL.md` file — frontmatter defines the name and description, the body is the instruction prompt given to the agent when the skill is invoked.

```
packages/skills-loader/skills/
  code-review/SKILL.md
  debug/SKILL.md
  documentation/SKILL.md
  git-commit/SKILL.md
  pr-review/SKILL.md
  refactor/SKILL.md
  security-review/SKILL.md
  test-writing/SKILL.md
```

Skills are loaded at runtime by `@ants/agent-skills-loader` and surfaced to the agent as callable slash-commands. To add a new skill: create a new directory under `packages/skills-loader/skills/` with a `SKILL.md` following the existing frontmatter format.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Language | TypeScript | 100% — server, agent, tools, UI, mobile |
| Monorepo | pnpm workspaces + Turborepo | ~25 packages, dependency-ordered builds |
| Frontend | React 19, Vite | Custom design-token theme (no Tailwind), Zustand state, Lucide icons, xterm.js terminal |
| Mobile | React Native + Expo | Shared components with web via React Native Web |
| Desktop | Electron + electron-vite | Same React UI, native shell via node-pty |
| Backend | Hono on Node.js | HTTP + WebSocket (`@hono/node-ws`), node-pty for terminals |
| Database | SQLite + Drizzle ORM | Embedded, one DB per deployment (`better-sqlite3`) |
| Sandbox | Docker + git worktrees | `packages/docker`, `packages/agent-worktree` |
| Memory | ONNX Runtime (local) | Semantic embeddings, no external vector DB |
| Auth | OAuth 2.0, jose (JWT), keytar | Anthropic OAuth, Cloudflare Access support |
| Agent protocol | MCP (Model Context Protocol) | `packages/mcp-stdio` — any MCP server plugs in |
| LLM providers | Anthropic, OpenAI, Google, Groq, xAI, OpenRouter | `packages/providers` |
| Testing | Vitest + Playwright | Unit/integration + E2E desktop/web |
| CI | GitHub Actions | Test (Node 20/22), lint, coverage, E2E |

### Module resolution

- Agent packages (`packages/*`): `module: NodeNext`, `moduleResolution: NodeNext`
- App packages (`apps/*`, `ui`, `server-ui`): `module: ESNext`, `moduleResolution: bundler`
- `apps/server` has a standalone tsconfig — **do not extend `tsconfig.base.json`** (it enables strict flags that surface pre-existing server type errors)

---

## MCP Servers

MCP servers extend what agents can do beyond the built-in tool suite. They are configured per-project through the server UI or API, and loaded at session start via `packages/mcp-stdio`.

### Adding an MCP server

Via API:
```bash
POST /api/projects/:id/mcp-servers
{
  "name": "filesystem",
  "config": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
  }
}
```

Via the project settings UI: **Settings → MCP Servers → Add Server**

### Common MCP servers

| Server | Package | What it adds |
|---|---|---|
| Filesystem | `@modelcontextprotocol/server-filesystem` | Read/write files outside the workspace |
| GitHub | `@modelcontextprotocol/server-github` | PRs, issues, code search |
| Slack | community | Send messages, read channels |
| Postgres | `@modelcontextprotocol/server-postgres` | Query a database |

Any stdio-compatible MCP server works. The protocol is handled by `@ants/agent-mcp-stdio`.

---

## Skills

Skills are reusable instruction prompts that agents invoke via slash-commands. They encode best-practice workflows for common tasks.

| Skill | Command | What it does |
|---|---|---|
| `code-review` | `/code-review` | Systematic review: correctness, quality, performance, security |
| `debug` | `/debug` | Root cause analysis and fix |
| `documentation` | `/documentation` | Write or update docs for code |
| `git-commit` | `/git-commit` | Stage and commit with a well-formed message |
| `pr-review` | `/pr-review` | Review a pull request end-to-end |
| `refactor` | `/refactor` | Restructure code without changing behavior |
| `security-review` | `/security-review` | Audit for vulnerabilities (OWASP, secrets, auth) |
| `test-writing` | `/test-writing` | Write tests with good coverage |

Skills live in `packages/skills-loader/skills/<name>/SKILL.md`. The frontmatter `description` field is what the agent sees when deciding which skill to use — keep it precise.

---

## Common Pitfalls

- **Cyclic deps**: `@ants/agent-core` cannot depend on `@ants/agent-providers`. Tests in core use mocks only.
- **Missing direct deps**: pnpm strict mode does not hoist. Every imported package must be declared in the package's own `package.json`.
- **Test files in build**: tsconfig `include: ["src/**/*"]` without excluding `__tests__/` breaks builds when test files import vitest. Always add `"exclude": ["src/**/__tests__/**"]`.
- **Build before run**: Source changes to any `@ants/*` package require `pnpm build` + server restart before taking effect.
- **Server tsconfig**: Do not extend `tsconfig.base.json` in `apps/server` — the base enables `noUncheckedIndexedAccess` and `verbatimModuleSyntax` which surface many pre-existing errors.
- **UI colors**: Never hardcode hex values in components. Use design tokens from `packages/ui/src/styles/tokens.ts`.
