---
title: Architecture
description: How OpenMgr is structured — server, agent framework, apps, and how they fit together.
sidebar:
  order: 1
---

## System Overview

OpenMgr is a monorepo with three main layers:

```
┌─────────────────────────────────────────────────────┐
│                    Client Apps                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Desktop  │  │  Mobile  │  │  Web UI  │          │
│  │ (Electron)│  │ (Expo)   │  │ (React)  │          │
│  └─────┬─────┘  └─────┬────┘  └─────┬────┘          │
│        │              │              │               │
│        └──────────────┼──────────────┘               │
│                       │ REST API + SSE               │
├───────────────────────┼─────────────────────────────┤
│                 OpenMgr Server                       │
│  ┌────────────────────┼────────────────────────┐    │
│  │  Hono HTTP Server  │  SQLite + Drizzle ORM  │    │
│  │  Routes  Services  │  23 tables             │    │
│  └────────────────────┼────────────────────────┘    │
│                       │ spawns + manages             │
├───────────────────────┼─────────────────────────────┤
│               Agent Processes                        │
│  ┌────────────────────────────────────────────┐     │
│  │  Agent Core (orchestrator)                  │     │
│  │  ├── LLM Providers (14+)                   │     │
│  │  ├── Tools (file, terminal, browser, etc.)  │     │
│  │  ├── Plugins (MCP, custom)                  │     │
│  │  ├── Sessions (conversation management)     │     │
│  │  └── Memory (vector embeddings)             │     │
│  └────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────┘
```

## Server

The server (`apps/server/`) is a Hono HTTP server with SQLite storage via Drizzle ORM. It's the central hub:

- **Service container** — `createServices(config, db)` wires all services with dependency injection
- **Route files** — Each route file exports a function that registers endpoints on the Hono app
- **21 route groups** — Projects, sessions, files, terminals, tasks, channels, providers, tools, plugins, webhooks, approvals, notifications, analytics, users, health, and more
- **23 database tables** — Managed by Drizzle ORM with SQL migrations

The server spawns one agent process per project and communicates with it via HTTP.

## Agent Framework

The agent framework (`packages/core/`) is the brain:

- **Agent class** — Central orchestrator for LLM communication, tool execution, plugins, MCP servers, and conversation management
- **Five registries** — Tool, Provider, Command, AgentType, and Capability registries are instance-scoped with global singleton defaults
- **Plugin system** — Extensible via plugins that can add tools, providers, commands, and capabilities
- **MCP support** — Connect to external MCP servers for additional tools and capabilities

## Package Map

| Package | Purpose |
|---------|---------|
| `apps/server` | Hono HTTP server (SQLite + Drizzle) |
| `apps/desktop` | Electron desktop app |
| `apps/mobile` | React Native / Expo mobile app |
| `packages/core` | Agent framework (orchestrator, plugins, MCP, tools) |
| `packages/providers` | LLM provider adapters |
| `packages/cli` | Command-line interface |
| `packages/server` | Embeddable agent HTTP server |
| `packages/ui` | Shared React components (cross-platform) |
| `packages/tools` | Platform-agnostic tools |
| `packages/tools-terminal` | Terminal/filesystem tools (Node.js) |
| `packages/database` | SQLite adapter (better-sqlite3) |
| `packages/database-core` | Database interface and schema |
| `packages/storage` | Session persistence |
| `packages/memory` | Vector memory |
| `packages/server-ui` | Server web UI (React + Vite) |

## Data Flow

### Prompt Lifecycle

1. Client sends `POST /projects/:id/sessions/:sid/prompt` with message content
2. Server forwards the prompt to the project's agent process
3. Agent sends the message to the configured LLM provider
4. LLM responds with text and/or tool calls
5. Agent executes any tool calls (file writes, terminal commands, etc.)
6. Agent streams the response back to the server via SSE
7. Server streams the response to the client

### Project Lifecycle

1. `POST /projects` creates the project record, workspace directory, and agent process
2. The agent process starts and registers its tools, providers, and plugins
3. Sessions are created within the project for conversations
4. The agent process runs until the project is deleted or the server restarts

## Technology Stack

- **TypeScript** — Entire codebase
- **pnpm + Turborepo** — Monorepo management and build orchestration
- **Hono** — HTTP server framework
- **SQLite + Drizzle ORM** — Database
- **React** — UI framework (web, desktop, mobile)
- **React Native + Expo** — Mobile app
- **Electron** — Desktop app
- **Vite** — Build tool for UI packages
- **Vitest** — Test framework
