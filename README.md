# ants

A self-hostable background agent harness — the open-source version of [Ramp Inspect](https://builders.ramp.com/post/why-we-built-our-background-agent), Stripe Minions, and Shopify River.

You submit a task. A colony of parallel AI workers executes it. Results come back across any interface — desktop, mobile, CLI, or API. No proprietary cloud required.

## What is this?

The bottleneck in AI coding isn't the LLM — it's the feedback loop. An agent that can write code *and then run tests, check logs, verify visually, and open a PR* is qualitatively different from a chat assistant. Ramp found that ~30% of their PRs now come from their internal agent (Inspect) after just a few months, with no forced adoption. Stripe and Shopify have built the same pattern internally. Ants is the open-source version of all three — same architecture, your infra, any LLM.

What makes ants different from those proprietary systems:

- **You own the infra** — no Modal, no proprietary cloud sandbox, runs anywhere Docker runs
- **Any LLM** — Claude, GPT, Gemini, Groq, xAI, OpenRouter — not locked to one provider
- **Every interface** — desktop app, mobile app, CLI, or HTTP API
- **Extensible** — MCP plugins let you wire in Sentry, Datadog, Slack, GitHub, or any tool your stack uses

**ants** gives you:

- A **self-hostable server** — run your agents on your own machine or VPS, your data stays yours
- A **desktop app** (Mac/Windows) — chat UI with full agent capabilities
- A **mobile app** (iOS/Android) — control your agents from anywhere
- An **orchestrator** — a director agent that spawns and manages a colony of parallel workers

The name fits: ants work in parallel, each on their own task, coordinated by a shared colony. That's the model here.

## How it works

A director agent sits at the top. It breaks tasks into subtasks, spins up worker agents, hands each one a job, and collects results — all running concurrently. Each worker has the full tool suite: terminal access, file editing, web browsing, and code intelligence via LSP. Workers close the loop on their own work — they write code, run tests, check the output, and open PRs without waiting for a human in the middle.

```
You submit a task
  └── Director Agent plans and dispatches
      ├── Worker 1: write the feature
      ├── Worker 2: write the tests
      └── Worker 3: update the docs
          Each worker:
          ├── calls an LLM (Claude, GPT, Gemini, Groq, etc.)
          ├── uses tools: bash, read/write files, browser, LSP
          ├── persists memory to SQLite
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

  tools-terminal/   Bash, read, write, edit, grep — the coding tools
  tools/            Web search, todos, skills
  tools-director/   Meta-tools: manage projects, sessions, Docker, settings
  browser-core/     Browser control

  database/     SQLite via Drizzle ORM
  memory/       Semantic memory with local embeddings
  scheduler/    Cron and scheduled tasks

  server/       Embeddable HTTP/WebSocket server
  mcp-stdio/    MCP protocol (plug in any MCP-compatible tool)
  lsp/          Language Server Protocol (code intelligence)

  ui/           Shared React chat UI (desktop + web)
  cli/          Command-line interface
```

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm 9

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
pnpm build                                          # Build everything
pnpm turbo build --filter=@ants/server          # Build one package + deps
pnpm test                                           # Run all tests
pnpm dev                                            # Watch mode
pnpm lint
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system diagrams, task flow, deployment modes, and a comparison with Ramp Inspect / Stripe Minions / Shopify River.

## License

MIT
