---
title: REST API
description: Complete REST API reference for the Ants server.
sidebar:
  order: 1
---

All endpoints (except `/health` and webhook endpoints) require authentication via `Authorization: Bearer <token>` header.

## Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/projects` | List all projects |
| `POST` | `/projects` | Create a new project |
| `GET` | `/projects/:id` | Get project details |
| `PATCH` | `/projects/:id` | Update project |
| `DELETE` | `/projects/:id` | Delete project and its workspace |
| `POST` | `/projects/:id/restart` | Restart the project's agent server |

### Create a Project

```bash
curl -X POST http://localhost:6647/projects \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project", "description": "Optional description"}'
```

## Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/projects/:id/sessions` | Create a new session |
| `GET` | `/projects/:id/sessions/:sid` | Get session details |
| `DELETE` | `/projects/:id/sessions/:sid` | Delete session |
| `GET` | `/projects/:id/sessions/:sid/messages` | Get message history |
| `POST` | `/projects/:id/sessions/:sid/prompt` | Send a prompt (returns SSE stream) |
| `POST` | `/projects/:id/sessions/:sid/abort` | Abort a running prompt |

### Send a Prompt

```bash
curl -X POST http://localhost:6647/projects/PROJECT_ID/sessions/SESSION_ID/prompt \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Create a hello world Express app"}'
```

The response is streamed via Server-Sent Events (SSE) with incremental updates as the agent generates its response.

## Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/projects/:id/files` | List files in the project workspace |
| `GET` | `/projects/:id/files/content` | Read a file's content |
| `PUT` | `/projects/:id/files/content` | Write content to a file |
| `POST` | `/projects/:id/files/directory` | Create a directory |
| `DELETE` | `/projects/:id/files` | Delete a file or directory |

### Read a File

```bash
curl "http://localhost:6647/projects/PROJECT_ID/files/content?path=src/index.ts" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Terminals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/projects/:id/terminals` | Create a terminal session |
| `GET` | `/projects/:id/terminals/:tid/ws` | WebSocket connection for terminal I/O |

Terminal sessions use WebSockets for real-time bidirectional communication.

## Tasks (Scheduled)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/projects/:id/tasks` | List scheduled tasks |
| `POST` | `/projects/:id/tasks` | Create a scheduled task |
| `POST` | `/projects/:id/tasks/:tid/run` | Run a task immediately |

## Channels (Messaging Integrations)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/channels` | List all channels |
| `POST` | `/channels` | Create a channel |
| `GET` | `/channels/:id` | Get channel details |
| `PATCH` | `/channels/:id` | Update channel |
| `DELETE` | `/channels/:id` | Delete channel |
| `GET` | `/channels/:id/bindings` | List project bindings |
| `POST` | `/channels/:id/bindings` | Create a project binding |
| `PATCH` | `/channels/:id/bindings/:bid` | Update binding |
| `DELETE` | `/channels/:id/bindings/:bid` | Delete binding |
| `POST` | `/channels/:id/send` | Send an outbound message |
| `POST` | `/channels/slack/events` | Slack webhook endpoint (no auth required) |

## Provider API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| `PUT` | `/system/api-keys/:provider` | Set a provider's API key |

Provider identifiers: `anthropic`, `openai`, `google`, `openrouter`, `groq`, `xai`, `aws-bedrock`, `azure-openai`, `google-vertex`, `mistral`, `cohere`, `together`, `fireworks`, `deepseek`.

```bash
curl -X PUT http://localhost:6647/system/api-keys/anthropic \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "sk-ant-..."}'
```

## System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (no auth required) |
| `GET` | `/system/agent` | Agent installation status |

## Error Responses

All errors return JSON with an `error` field:

```json
{
  "error": "Project not found"
}
```

Common HTTP status codes:

| Status | Meaning |
|--------|---------|
| `400` | Bad request — invalid parameters or body |
| `401` | Unauthorized — missing or invalid token |
| `403` | Forbidden — insufficient permissions |
| `404` | Not found |
| `500` | Internal server error |
