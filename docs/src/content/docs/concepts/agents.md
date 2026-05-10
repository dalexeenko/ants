---
title: Agents & Sessions
description: How agents work in OpenMgr — the orchestrator, sessions, tools, and conversation management.
sidebar:
  order: 2
---

## Agent Core

The `Agent` class in `packages/core/` is the central orchestrator. Each project gets its own agent process that handles:

- **LLM communication** — Sending prompts to providers and streaming responses
- **Tool execution** — Running tools within the project workspace
- **Plugin management** — Loading MCP servers, custom tools, and extensions
- **Session management** — Maintaining conversation context and history
- **Compaction** — Summarizing long conversations to stay within context limits

## Sessions

Sessions are conversations between a user and an agent within a project. Each session maintains its own message history and context.

### Creating a Session

```bash
curl -X POST http://localhost:6647/projects/PROJECT_ID/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Sending a Prompt

```bash
curl -X POST http://localhost:6647/projects/PROJECT_ID/sessions/SESSION_ID/prompt \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Create a REST API with Express"}'
```

The response is streamed via SSE with incremental updates.

### Aborting a Prompt

```bash
curl -X POST http://localhost:6647/projects/PROJECT_ID/sessions/SESSION_ID/abort \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Registries

The agent uses five registries to manage its capabilities:

| Registry | Purpose |
|----------|---------|
| **Tool** | Available tools (file operations, terminal, browser, etc.) |
| **Provider** | LLM provider adapters (Anthropic, OpenAI, etc.) |
| **Command** | Slash commands available in the agent |
| **AgentType** | Agent behavior configurations |
| **Capability** | Feature flags and capability declarations |

Registries are instance-scoped — each agent process has its own set of registries with global singleton defaults that can be overridden per-project.

## Conversation Flow

1. User sends a prompt via the API
2. Agent prepares the message with system instructions, conversation history, and available tools
3. Agent sends to the LLM provider
4. LLM returns text and/or tool call requests
5. If tool calls are present, the agent executes them and sends results back to the LLM
6. This loop continues until the LLM produces a final text response
7. The full response (including tool results) is streamed back to the client

## Context Management

Long conversations can exceed LLM context limits. The agent handles this with:

- **Compaction** — Summarizing older messages to reduce token count while preserving key context
- **Session persistence** — Sessions are stored in the database and can be resumed across server restarts

## Human-in-the-Loop

The approval system allows requiring human approval before certain agent actions:

- Approvals are managed via the `/approvals` API endpoints
- Configurable per-project and per-tool
- The agent pauses execution and waits for approval before proceeding with the action
