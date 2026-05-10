# ants

An open-source AI agent platform. Each project is an isolated environment with its own AI conversation, sandboxed container, tool suite, and persistent state — running in parallel, on your own infrastructure.

Think of it as the self-hostable version of [Ramp Inspect](https://builders.ramp.com/post/why-we-built-our-background-agent), Stripe Minions, and Shopify River.

## What is this?

The bottleneck in AI coding isn't the LLM — it's the feedback loop. An agent that can write code *and then run tests, check logs, verify visually, and open a PR* is qualitatively different from a chat assistant. Ramp found that ~30% of their PRs now come from their internal agent after just a few months, with no forced adoption. Stripe and Shopify built the same pattern internally. Ants is the open-source version of all three — same architecture, your infra, any LLM.

Each **workspace** is a self-contained unit:

| | What it is |
|---|---|
| **Conversation** | Persistent AI chat session — full history, context compaction, branching |
| **Sandbox** | Docker container or git worktree — isolated execution environment |
| **Tools** | bash, file read/write/edit, browser control, LSP, MCP plugins |
| **State** | SQLite per project + semantic memory with local embeddings |

A director agent sits at the top, breaking tasks into subtasks and dispatching them to a colony of parallel workers. Workers close the loop on their own: write code → run tests → check output → open PR, without waiting for a human in the middle.

What makes ants different from the proprietary systems:

- **You own the infra** — runs anywhere Docker runs, no Modal or proprietary cloud sandbox
- **Any LLM** — Claude, GPT, Gemini, Groq, xAI, OpenRouter — not locked to one provider
- **Every interface** — desktop app, mobile app, CLI, or HTTP API
- **Extensible** — MCP plugins wire in Sentry, Datadog, Slack, GitHub, or anything else

## Tech Stack

**Language:** TypeScript throughout — server, agent core, all tools, UI, mobile.

**Monorepo:** pnpm workspaces + Turborepo — ~25 packages, build order handled automatically.

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite, custom design-token theme system (light/dark), Zustand state, xterm.js terminal, Lucide icons |
| **Mobile** | React Native + Expo — shared component layer with the web UI via React Native Web |
| **Desktop** | Electron + electron-vite — same React UI, native shell access |
| **Backend** | [Hono](https://hono.dev) on Node.js — HTTP + WebSocket, node-pty for terminal sessions |
| **Database** | SQLite via [Drizzle ORM](https://orm.drizzle.team) — one database per deployment, embedded, no separate server |
| **Sandbox** | Docker containers (`packages/docker`) + git worktrees (`packages/agent-worktree`) — agents work in isolated branches or containers |
| **Memory** | Local embeddings via ONNX Runtime — semantic search over conversation history, no external vector DB |
| **Auth** | OAuth 2.0 (jose for JWT), keytar for secure credential storage, Anthropic OAuth support |
| **Agent protocol** | [MCP](https://modelcontextprotocol.io) (Model Context Protocol) — plug in any MCP-compatible tool server |
| **Testing** | Vitest (unit + integration) + Playwright (E2E desktop + web) |

## How it works

```
You submit a task
  └── Director Agent plans and dispatches
      ├── Worker 1: write the feature      ─┐
      ├── Worker 2: write the tests         ├── run in parallel, each in its own sandbox
      └── Worker 3: update the docs        ─┘
          Each worker:
          ├── calls an LLM (Claude, GPT, Gemini, Groq, etc.)
          ├── uses tools: bash, read/write files, browser, LSP
          ├── persists state to SQLite
          └── loads MCP plugins for external tools
```

## Repository Structure

```
apps/
  server/       Self-hosted server — deploy this for team or remote access
  desktop/      Desktop app (Electron)
  mobile/       Mobile app (React Native)

packages/
  core/         Agent loop, plugin system, context compaction, MCP
  providers/    LLM adapters: Anthropic, OpenAI, Google, OpenRouter, Groq, xAI
  agent/        Full agent assembled from all packages
  node/         Node.js agent with full filesystem access

  tools-terminal/   bash, read, write, edit, grep
  tools/            web search, todos, skills
  tools-director/   spawn/manage sessions, Docker, project settings
  browser-core/     headless browser control

  database/     SQLite via Drizzle ORM
  memory/       semantic memory with local embeddings
  scheduler/    cron and scheduled tasks
  verifiers/    reward functions for RL evaluation

  server/       embeddable HTTP/WebSocket server
  mcp-stdio/    MCP protocol client
  lsp/          Language Server Protocol integration
  docker/       Docker container management
  agent-worktree/ git worktree isolation

  ui/           shared React chat UI (desktop + web)
  cli/          command-line interface

tests/
  agent-task-tests/   episode harness + verifiable reward tasks
  agent-e2e-tests/    CLI and HTTP server E2E
  app-integration-tests/  server API integration
  server-ui-e2e/      Playwright web UI tests
```

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm 9
- Docker (optional — for sandbox containers)

### Setup

```bash
git clone https://github.com/dalexeenko/ants.git
cd ants
pnpm install
pnpm build
```

### Run the Desktop App

```bash
pnpm dev:desktop
```

### Run the Server

```bash
pnpm dev:server
```

### Run with Docker

```bash
docker run -p 6647:6647 \
  -v ants-data:/data \
  -v ants-workspaces:/workspaces \
  -e ANTS_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  ants/server
```

Or with Docker Compose:

```bash
cd apps/server
docker compose up
```

## Development

```bash
pnpm build                                    # Build everything
pnpm turbo build --filter=@ants/server        # Build one package + deps
pnpm test                                     # Run all tests
pnpm dev                                      # Watch mode
pnpm lint
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system diagrams, task flow, deployment modes, RL with verifiable rewards, and a comparison with Ramp Inspect / Stripe Minions / Shopify River.

## License

MIT
