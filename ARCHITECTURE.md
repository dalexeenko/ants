# Architecture

Ants is a background agent harness — the same category as Stripe Minions, Ramp Inspect, and Shopify River. You submit a task; a colony of parallel AI workers executes it in isolated sessions; results come back to you across any interface.

The key insight from Ramp's writeup: the bottleneck in AI coding isn't the LLM, it's the feedback loop. An agent that can write code *and then run tests, check logs, verify visually, and open a PR* is qualitatively different from a chat assistant. Ants is built around closing that loop.

## System Overview

```mermaid
flowchart TD
    subgraph Interfaces["Interfaces"]
        CLI[CLI]
        Desktop[Desktop App\nElectron]
        Mobile[Mobile App\nReact Native]
        API[HTTP / WebSocket API]
    end

    subgraph Director["Director Agent (Orchestrator)"]
        LOOP[Agent Loop\ncore]
        SCHED[Scheduler\nCron / triggers]
        DISPATCH[Task Dispatcher]
    end

    subgraph Colony["Worker Colony (parallel sessions)"]
        W1[Worker Agent 1]
        W2[Worker Agent 2]
        W3[Worker Agent 3]
        WN[Worker Agent N]
    end

    subgraph PerWorker["Each Worker Has"]
        LLM[LLM\nClaude / GPT / Gemini / etc.]
        TOOLS[Tools\nbash · read/write · edit · grep]
        BROWSER[Browser\nheadless control]
        LSP[LSP\ncode intelligence]
        MCP[MCP Plugins\nexternal tools]
    end

    subgraph Shared["Shared Infrastructure"]
        DB[(SQLite\nconversations · stats · settings)]
        MEM[Semantic Memory\nlocal embeddings]
        STORAGE[Session Storage\nworktrees · artifacts]
    end

    Interfaces --> Director
    LOOP --> DISPATCH
    SCHED --> DISPATCH
    DISPATCH --> W1
    DISPATCH --> W2
    DISPATCH --> W3
    DISPATCH --> WN
    W1 & W2 & W3 & WN --> PerWorker
    PerWorker --> Shared
```

## How a Task Flows

```mermaid
sequenceDiagram
    actor User
    participant Interface as Interface\n(Desktop / API / CLI)
    participant Director as Director Agent
    participant Worker as Worker Agent(s)
    participant Tools as Tools\n(bash, files, browser)
    participant LLM as LLM Provider

    User->>Interface: "Fix the login bug and open a PR"
    Interface->>Director: task submitted
    Director->>Director: plan — break into subtasks
    Director->>Worker: spawn worker(s) in isolated session(s)

    loop Agent loop
        Worker->>LLM: next action?
        LLM-->>Worker: call tool X
        Worker->>Tools: execute
        Tools-->>Worker: result
    end

    Worker->>Tools: run tests, open PR
    Worker-->>Director: done — PR #123
    Director-->>Interface: result + summary
    Interface-->>User: ✓ PR opened
```

## Deployment Modes

```mermaid
flowchart LR
    subgraph Local["Local (single user)"]
        D[Desktop App] --> LA[Local Agent\nNode.js process]
        CLI2[CLI] --> LA
    end

    subgraph Server["Self-hosted Server (team)"]
        WEB[Web UI] --> SRV[Ants Server\nDocker]
        SLACK[Slack / webhook] --> SRV
        SRV --> A1[Agent Pool]
    end

    subgraph Storage2["Persistent Storage"]
        VOL1[(ants-data\nSQLite · settings)]
        VOL2[(ants-workspaces\nworktrees · artifacts)]
    end

    LA --> VOL1
    A1 --> VOL1
    A1 --> VOL2
```

## Package Map

```
apps/
  server/          → Docker-deployable server (Hono + SQLite)
  desktop/         → Electron desktop app
  mobile/          → React Native mobile app

packages/
  core/            → Agent loop, plugin system, context compaction
  agent/           → Full agent assembled from all packages
  node/            → Node.js agent with full filesystem access
  providers/       → LLM adapters: Claude, GPT, Gemini, Groq, xAI, OpenRouter

  tools-terminal/  → bash · read · write · edit · grep
  tools/           → web search · todos · skills
  tools-director/  → spawn/manage sessions, Docker, project settings
  browser-core/    → headless browser control

  server/          → embeddable HTTP/WebSocket server
  mcp-stdio/       → MCP protocol (plug in any external tool)
  lsp/             → Language Server Protocol (code intelligence)
  scheduler/       → cron + event-triggered task scheduling

  database/        → SQLite via Drizzle ORM
  memory/          → semantic memory with local embeddings
  storage/         → session and artifact persistence

  ui/              → shared React chat UI
  cli/             → command-line interface
```

## Comparison

| | Ramp Inspect | Stripe Minions | Shopify River | **Ants** |
|---|---|---|---|---|
| Infra | Modal cloud sandboxes | Internal cloud | Internal cloud | **Self-hosted / your infra** |
| LLM | Proprietary mix | Proprietary mix | Proprietary mix | **Any: Claude, GPT, Gemini, Groq...** |
| Access | Slack, web, Chrome ext, PRs | Internal | Internal | **Desktop, mobile, CLI, API** |
| Source | Closed | Closed | Closed | **Open source** |
| Multi-agent | Yes | Yes | Yes | **Yes** |
| Feedback loop | Tests + Sentry + Datadog | Tests | Tests | **Tests + LSP + browser** |

The fundamental bet is the same across all four: background agents that close the loop on their own work (write → test → verify → ship) will generate a non-trivial fraction of all code at a team. Ants makes that pattern available to anyone, on any stack, without a proprietary cloud dependency.
