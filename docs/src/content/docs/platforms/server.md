---
title: Server & Web UI
description: The OpenMgr self-hosted server — REST API, built-in web UI, and real-time streaming.
sidebar:
  order: 1
---

The OpenMgr server is a Hono HTTP server backed by SQLite (via Drizzle ORM). It provides a REST API for all operations and includes a built-in web UI for managing your agents.

## Web UI

The server includes a built-in web UI at the root URL (`http://localhost:6647` by default). It provides:

- **Project management** — Create, configure, and delete projects
- **Session management** — Start conversations with agents, view message history
- **File browser** — Browse and edit project files
- **Terminal** — WebSocket-based terminal I/O within projects
- **Settings** — Configure LLM provider API keys, server settings
- **Channel management** — Set up Slack and other messaging integrations

### Full Web App

An optional full-featured web app is available at `/app` when enabled:

```bash
OPENMGR_WEB_APP=true
```

This provides a richer interface with additional features beyond the default server UI.

## API Authentication

All API endpoints (except `/health` and webhook endpoints) require authentication.

### Bearer Token (default)

Include the token in every request:

```
Authorization: Bearer <your-token>
```

The token is printed to the console on server startup. Set `OPENMGR_SECRET` for a stable token.

### Multi-User Mode

When multi-user mode is enabled, authentication uses session cookies or user API tokens instead of a shared bearer token. See the [Multi-User Mode guide](/guides/multi-user/).

## Real-Time Streaming

Agent responses are streamed via **Server-Sent Events (SSE)**. When you send a prompt, the server returns an SSE stream with incremental updates as the agent generates its response.

## MCP Server Mode

The server can also act as an MCP (Model Context Protocol) server, allowing external tools and editors to connect to it. The `openmgr-server-mcp` binary is included in the server package.
