---
title: Messaging Channels
description: Connect agents to Slack, Discord, Telegram, and other messaging platforms.
sidebar:
  order: 6
---

Channels enable bidirectional communication between OpenMgr projects and external messaging platforms.

## Overview

The channels system supports:

- **Inbound messages** — Users trigger agents via @mentions, DMs, etc.
- **Outbound messages** — Agents proactively send messages to channels
- **Thread-based sessions** — Platform threads map to agent sessions for context continuity
- **Many-to-many bindings** — One channel can route to multiple projects based on rules

## Architecture

```
┌───────────────────────────────────────────────────────┐
│                    OPENMGR SERVER                       │
│                                                         │
│  Platform Webhook ──► Channel Router                    │
│  POST /channels/       - Validates signatures           │
│  {type}/events         - Routes to adapter              │
│                        - Matches trigger rules          │
│                              │                          │
│                              ▼                          │
│                     Message Queue (SQLite)               │
│                     - Persists messages                  │
│                     - Tracks processing status           │
│                     - Enables retry on failure           │
│                              │                          │
│                              ▼                          │
│                   Message Processor                      │
│                   - Maps threads to sessions             │
│                   - Invokes agent with message           │
│                   - Queues response for delivery         │
│                              │                          │
│                    ┌─────────┴──────────┐               │
│                    ▼                    ▼               │
│              Agent Session      Channel Adapters        │
│              (conversation)     ├── SlackAdapter        │
│                                 └── (future adapters)   │
└───────────────────────────────────────────────────────┘
```

## Supported Platforms

| Platform | Status | Trigger Events |
|----------|--------|----------------|
| **Slack** | Available | @mentions, direct messages |
| **Discord** | Planned | |
| **Telegram** | Planned | |
| **Twitter** | Planned | |
| **Reddit** | Planned | |

## Key Concepts

### Channels

A channel represents a connection to a messaging platform (e.g., a Slack workspace). It stores:

- Platform type and configuration
- Encrypted credentials (bot tokens, signing secrets)
- Enabled/disabled state

### Bindings

Bindings connect channels to projects with trigger rules. They define:

- **Which events** trigger the agent (mentions, DMs, keywords, etc.)
- **Which project** handles the message
- **How the agent responds** (in-thread, as DM, etc.)
- **Priority** for routing when multiple bindings match

### Message Queue

All inbound and outbound messages go through a persistent SQLite queue for reliability. Messages are retried on failure with tracked attempt counts.

### Thread Sessions

Platform threads (Slack threads, etc.) are mapped to agent sessions. This preserves conversation context — a user can have an ongoing conversation with the agent in a thread, and the agent remembers the full history.

## Setting Up a Channel

See the [Slack Integration guide](/guides/slack-integration/) for a step-by-step walkthrough.

### API Overview

```bash
# Create a channel
POST /channels

# List channels
GET /channels

# Create a binding (connect channel to project)
POST /channels/:id/bindings

# Send an outbound message
POST /channels/:id/send
```

### Trigger Events

| Event | Description |
|-------|-------------|
| `mention` | Bot is @mentioned in a channel |
| `direct_message` | Direct message to the bot |
| `reaction` | Emoji reaction on a message |
| `keyword` | Message contains a keyword match |
| `channel_message` | Any message in specific channels |

### Response Configuration

| Option | Description |
|--------|-------------|
| `threadBehavior` | `always` — always reply in thread, `if_exists` — only if thread exists, `never` — top-level reply |
| `typingIndicator` | Show typing/processing indicators (uses reactions on Slack) |
| `maxResponseLength` | Truncate responses beyond this length |
