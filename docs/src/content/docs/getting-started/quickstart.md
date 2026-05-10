---
title: Quickstart
description: Go from zero to a running Ants server in under 5 minutes.
---

Get Ants running locally and create your first AI coding project.

## Prerequisites

- **Node.js** >= 20
- An API key for at least one LLM provider (Anthropic, OpenAI, Google, etc.)

:::tip
Check your Node version with `node --version`. We recommend Node 22 for the best experience.
:::

## Start the Server

The fastest way to run Ants:

```bash
npx @ants/server
```

This downloads and starts the server on `http://localhost:6647`. On first startup, the server prints a **bearer token** to the console — save this, you'll need it to authenticate.

:::note
The bearer token is auto-generated on first run. Set `ANTS_SECRET` to use a stable token across restarts. See [Configuration](/getting-started/configuration/) for details.
:::

## Open the Web UI

Navigate to [http://localhost:6647](http://localhost:6647) in your browser. The built-in web UI lets you:

- Create and manage projects
- Configure LLM provider API keys
- Start agent sessions and chat with your agents
- Browse project files and terminals

## Configure an LLM Provider

Before your agents can do anything, you need to add at least one LLM API key.

### Via the Web UI

1. Go to **Settings** in the web UI
2. Under **API Keys**, click the provider you want to configure
3. Enter your API key and save

### Via the API

```bash
curl -X PUT http://localhost:6647/system/api-keys/anthropic \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "sk-ant-..."}'
```

Supported providers: `anthropic`, `openai`, `google`, `openrouter`, `groq`, `xai`, `aws-bedrock`, `azure-openai`, `google-vertex`, `mistral`, `cohere`, `together`, `fireworks`, `deepseek`.

## Create a Project

### Via the Web UI

1. Click **New Project**
2. Enter a name and optional description
3. The server creates a workspace directory and starts an agent process

### Via the API

```bash
curl -X POST http://localhost:6647/projects \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-first-project"}'
```

## Start a Session

Sessions are conversations with your agent. Create one and send a prompt:

```bash
# Create a session
curl -X POST http://localhost:6647/projects/PROJECT_ID/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Send a prompt
curl -X POST http://localhost:6647/projects/PROJECT_ID/sessions/SESSION_ID/prompt \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Create a hello world Express.js app"}'
```

The agent will use the configured LLM to generate code, create files, and execute commands in the project workspace.

## Next Steps

- [Installation](/getting-started/installation/) — All install methods (global, Docker, from source)
- [Configuration](/getting-started/configuration/) — Environment variables and settings reference
- [Docker Deployment](/guides/docker/) — Run with Docker and Docker Compose
- [Architecture](/concepts/architecture/) — Understand how Ants works under the hood
