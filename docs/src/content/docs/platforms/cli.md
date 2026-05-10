---
title: CLI
description: The OpenMgr command-line interface for interacting with agents from the terminal.
sidebar:
  order: 4
---

The OpenMgr CLI (`@openmgr/cli`) provides a command-line interface for running and interacting with agents.

## Installation

The CLI is included when you install the agent package:

```bash
npm install -g @openmgr/cli
```

The CLI is also available as `openmgr-agent` or `oa` after global installation.

## Overview

The CLI is primarily used by the server to spawn agent processes for projects. Each project gets its own agent process that the server communicates with.

The agent process handles:

- **LLM communication** — Sending prompts to configured providers and streaming responses
- **Tool execution** — Running tools (file operations, terminal commands, etc.) within the project workspace
- **Plugin management** — Loading and running plugins (MCP servers, custom tools, etc.)
- **Session management** — Maintaining conversation context and history
- **Compaction** — Summarizing long conversations to stay within context limits

## Agent Process Lifecycle

1. The server starts an agent process when a project is created or the server starts
2. The agent process binds to a port and communicates with the server via HTTP
3. Session prompts from the server are forwarded to the agent
4. The agent processes prompts using the configured LLM, executes tools, and streams responses back
5. The agent process runs until the project is deleted or the server shuts down

## Configuration

The agent inherits configuration from the server, including:

- LLM provider API keys
- Tool permissions and restrictions
- Plugin configuration
- Workspace directory paths
