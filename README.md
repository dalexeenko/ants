# ants

A platform for running and managing colonies of AI coding agents. Think of it as a control plane for AI workers — you dispatch tasks, agents go do the work, and you watch the results come in.

## What is this?

You want an AI coding assistant. Maybe several. Running in parallel. On your own hardware, not locked to someone else's cloud.

**ants** gives you:

- A **self-hostable server** — run your agents on your own machine or VPS, your data stays yours
- A **desktop app** (Mac/Windows) — chat UI with full agent capabilities
- A **mobile app** (iOS/Android) — control your agents from anywhere
- An **orchestrator** — one agent that spawns and manages many sub-agents (the colony)

The name fits: ants work in parallel, each on their own task, coordinated by a shared colony. That's the model here.

## How it works

```
You open the Desktop App
  └── talks to the Agent via WebSocket
      └── Agent runs the loop:
          ├── calls an LLM (Claude, GPT, Gemini, Groq, etc.)
          ├── uses tools: bash, read/write files, browser...
          ├── spawns sub-agents for parallel work
          ├── persists memory to SQLite
          └── loads MCP plugins for extra capabilities
```

A director agent sits at the top. It can spin up worker agents, hand each one a task, and collect results — all running concurrently. Each worker has the full tool suite: terminal access, file editing, web browsing, code intelligence via LSP.

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
  -e OPENMGR_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  openmgr/server
```

Or with Docker Compose:

```bash
cd apps/server
docker compose up
```

## Development

```bash
pnpm build                                          # Build everything
pnpm turbo build --filter=@openmgr/server          # Build one package + deps
pnpm test                                           # Run all tests
pnpm dev                                            # Watch mode
pnpm lint
```

## License

MIT
