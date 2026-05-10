# Messaging Channels

This document describes the messaging channels feature, which enables bidirectional communication between Ants projects and external messaging platforms (Slack, Discord, Twitter, etc.).

## Overview

Channels allow users to interact with Ants agents through familiar messaging platforms. The system supports:

- **Inbound messages**: Users trigger agents via @mentions, DMs, etc.
- **Outbound messages**: Agents can proactively send messages to channels
- **Thread-based sessions**: Platform threads map to agent sessions for context continuity
- **Many-to-many bindings**: One channel can route to multiple projects based on rules

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ANTS SERVER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐    ┌───────────────────────────────────────────────┐  │
│  │  Platform Webhook│───▶│            Channel Router                     │  │
│  │  POST /channels/ │    │  - Validates webhook signatures               │  │
│  │  {type}/events   │    │  - Routes to appropriate adapter              │  │
│  └──────────────────┘    │  - Matches triggers to project bindings       │  │
│                          └───────────────────────────────────────────────┘  │
│                                        │                                     │
│                                        ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        Message Queue (SQLite)                         │  │
│  │  - Persists inbound/outbound messages                                 │  │
│  │  - Tracks processing status                                           │  │
│  │  - Enables retry on failure                                           │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                        │                                     │
│                                        ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      Channel Message Processor                        │  │
│  │  - Dequeues pending messages                                          │  │
│  │  - Maps threads to sessions (channel_thread_sessions)                 │  │
│  │  - Invokes agent with message                                         │  │
│  │  - Queues response for outbound delivery                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                    │                                     │                   │
│                    ▼                                     ▼                   │
│  ┌─────────────────────────────┐      ┌─────────────────────────────────┐  │
│  │     Agent Session           │      │     Channel Adapters            │  │
│  │  (existing infrastructure)  │      │  ┌────────────────────────────┐ │  │
│  │  - Maintains conversation   │      │  │   SlackAdapter             │ │  │
│  │  - Processes prompts        │◀────▶│  │   - handleWebhook()        │ │  │
│  │  - Returns responses        │      │  │   - sendMessage()          │ │  │
│  └─────────────────────────────┘      │  │   - verifySignature()      │ │  │
│                                       │  └────────────────────────────┘ │  │
│                                       │  ┌────────────────────────────┐ │  │
│                                       │  │   (Future: Discord, etc.) │ │  │
│                                       │  └────────────────────────────┘ │  │
│                                       └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Model

### Channels Table

Stores platform connections (e.g., a Slack workspace).

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key (UUID) |
| type | TEXT | Platform type: 'slack', 'discord', etc. |
| name | TEXT | Display name |
| config | TEXT | JSON platform-specific configuration |
| credentials | TEXT | JSON encrypted credentials (tokens, secrets) |
| enabled | INTEGER | Whether channel is active |
| created_at | INTEGER | Timestamp |
| updated_at | INTEGER | Timestamp |

### Channel Project Bindings Table

Many-to-many relationship between channels and projects with trigger rules.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key (UUID) |
| channel_id | TEXT | Foreign key to channels |
| project_id | TEXT | Foreign key to projects |
| trigger_config | TEXT | JSON trigger rules (events, filters) |
| response_config | TEXT | JSON response settings |
| enabled | INTEGER | Whether binding is active |
| priority | INTEGER | For routing when multiple bindings match |
| created_at | INTEGER | Timestamp |
| updated_at | INTEGER | Timestamp |

### Channel Message Queue Table

Persistent queue for reliable message processing.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key (UUID) |
| channel_id | TEXT | Foreign key to channels |
| binding_id | TEXT | Foreign key to bindings (nullable for outbound) |
| direction | TEXT | 'inbound' or 'outbound' |
| status | TEXT | 'pending', 'processing', 'completed', 'failed' |
| payload | TEXT | JSON message content |
| platform_ref | TEXT | Platform message/thread ID |
| session_id | TEXT | Agent session ID |
| attempts | INTEGER | Retry count |
| last_error | TEXT | Last error message |
| created_at | INTEGER | Timestamp |
| processed_at | INTEGER | Timestamp |

### Channel Thread Sessions Table

Maps platform threads to agent sessions for context continuity.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key (UUID) |
| channel_id | TEXT | Foreign key to channels |
| project_id | TEXT | Foreign key to projects |
| platform_thread_id | TEXT | Platform-specific thread identifier |
| session_id | TEXT | Agent session ID |
| created_at | INTEGER | Timestamp |
| last_active_at | INTEGER | Timestamp |

## Core Abstractions

### Channel Types

```typescript
type ChannelType = 'slack' | 'discord' | 'twitter' | 'reddit' | 'telegram';

interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  config: ChannelConfig;
  credentials: ChannelCredentials;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Trigger Configuration

Controls when a channel activates a project.

```typescript
interface TriggerConfig {
  events: TriggerEvent[];
  filters?: TriggerFilter[];
}

type TriggerEvent = 
  | 'mention'           // @bot mention
  | 'direct_message'    // DM to bot
  | 'reaction'          // Emoji reaction
  | 'keyword'           // Keyword match
  | 'channel_message';  // Any message in specific channels

interface TriggerFilter {
  type: 'channel' | 'user' | 'keyword' | 'regex';
  include?: string[];
  exclude?: string[];
}
```

### Response Configuration

Controls how the agent responds.

```typescript
interface ResponseConfig {
  mode: 'reply' | 'thread' | 'dm' | 'channel';
  threadBehavior: 'always' | 'if_exists' | 'never';
  typingIndicator: boolean;
  maxResponseLength?: number;
}
```

### Channel Adapter Interface

Platform-specific implementations must implement this interface.

```typescript
interface ChannelAdapter {
  readonly type: ChannelType;
  
  // Lifecycle
  initialize(channel: Channel): Promise<void>;
  shutdown(): Promise<void>;
  
  // Health
  healthCheck(): Promise<HealthStatus>;
  
  // Inbound
  handleWebhook(request: WebhookRequest): Promise<WebhookResponse>;
  parseMessage(rawEvent: unknown): InboundMessage | null;
  
  // Outbound
  sendMessage(message: OutboundMessage): Promise<SendResult>;
  
  // Thread mapping
  getThreadId(message: InboundMessage): string;
  
  // Optional features
  addReaction?(messageId: string, emoji: string): Promise<void>;
  removeReaction?(messageId: string, emoji: string): Promise<void>;
}
```

## API Endpoints

### Channel Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /channels | List all channels |
| POST | /channels | Create a channel |
| GET | /channels/:id | Get channel details |
| PATCH | /channels/:id | Update channel |
| DELETE | /channels/:id | Delete channel |

### Binding Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /channels/:id/bindings | List project bindings |
| POST | /channels/:id/bindings | Create binding |
| PATCH | /channels/:id/bindings/:bid | Update binding |
| DELETE | /channels/:id/bindings/:bid | Delete binding |

### Messaging

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /channels/:id/send | Send outbound message |
| POST | /channels/slack/events | Slack webhook (no auth) |

## Slack Integration

### Supported Events

- `app_mention` - When the bot is @mentioned in a channel
- `message.im` - Direct messages to the bot

### Credentials Required

```typescript
interface SlackCredentials {
  botToken: string;      // xoxb-... Bot User OAuth Token
  signingSecret: string; // For webhook verification
}
```

### Configuration

```typescript
interface SlackChannelConfig {
  workspaceId: string;
  workspaceName: string;
  botUserId: string;
  allowedChannels?: string[];  // Optional channel whitelist
}
```

### Markdown Conversion

The Slack adapter automatically converts between standard Markdown and Slack's mrkdwn format:

| Standard Markdown | Slack mrkdwn |
|-------------------|--------------|
| `**bold**` | `*bold*` |
| `*italic*` | `_italic_` |
| `~~strike~~` | `~strike~` |
| `[text](url)` | `<url\|text>` |
| `` `code` `` | `` `code` `` |
| ` ```code``` ` | ` ```code``` ` |

### Typing Indicators

Since Slack doesn't support typing indicators for bots, we use reactions:
- `:eyes:` added when message is received (processing)
- `:eyes:` removed and `:white_check_mark:` added when response is sent

## Event Flow

### Inbound Message (Slack)

1. Slack sends event to `POST /channels/slack/events`
2. Router verifies HMAC-SHA256 signature
3. If `url_verification` challenge, respond immediately
4. Enqueue message with `status='pending'`
5. Return 200 OK to Slack (within 3 seconds)
6. Background processor picks up message
7. Find matching binding(s) by trigger rules
8. Get or create session for thread
9. Add `:eyes:` reaction to indicate processing
10. Send prompt to agent, await response
11. Convert response markdown to mrkdwn
12. Enqueue outbound message
13. Send to Slack via Web API
14. Remove `:eyes:`, add `:white_check_mark:`
15. Mark messages as completed

### Outbound Message (Agent-Initiated)

1. Agent or API calls `POST /channels/:id/send`
2. Enqueue message with `direction='outbound'`
3. Background processor picks up message
4. Adapter sends via platform API
5. Mark as completed

## Future Work

The following features are planned for future development:

- **Slash commands**: Custom `/commands` for Slack
- **Discord adapter**: Support for Discord servers
- **Twitter adapter**: Support for Twitter DMs and mentions
- **Telegram adapter**: Support for Telegram bots
- **Reddit adapter**: Support for Reddit mentions
- **Message attachments**: File uploads and downloads
- **Rich message formatting**: Cards, buttons, interactive elements

## App UI Integration

The following prompt can be used to generate the UI for channel management in the app (located at `../app`):

---

**Prompt for UI Implementation:**

Create a Channels management UI for the Ants app with the following features:

1. **Channels List Page** (`/channels`)
   - Display all configured channels in a list/grid
   - Show channel type icon (Slack, Discord, etc.), name, enabled status
   - Show count of connected projects per channel
   - Actions: Edit, Delete, Toggle enabled
   - "Add Channel" button

2. **Add/Edit Channel Modal**
   - Channel type selector (start with Slack only)
   - Name input
   - Platform-specific credential inputs:
     - Slack: Bot Token (password field), Signing Secret (password field)
   - Platform-specific config inputs:
     - Slack: Workspace ID, Bot User ID
   - Test connection button
   - Link to setup documentation

3. **Channel Detail Page** (`/channels/:id`)
   - Channel info header with status indicator
   - **Bindings section**: List of project bindings
     - Each binding shows: Project name, trigger events, enabled toggle
     - Add/Edit/Delete bindings
   - **Message Queue section**: Recent messages (debug view)
     - Show status, direction, timestamps
     - Filter by status
   - **Health section**: Connection status, last event received

4. **Add/Edit Binding Modal**
   - Project selector dropdown
   - Trigger events checkboxes: Mentions, Direct Messages
   - Optional filters:
     - Channel whitelist (Slack channel IDs)
     - User whitelist/blacklist
   - Response config:
     - Thread behavior: Always reply in thread, Only if thread exists
     - Typing indicator toggle
   - Priority input (for multiple bindings)

5. **API Integration**
   - `GET /channels` - List channels
   - `POST /channels` - Create channel
   - `GET /channels/:id` - Get channel with bindings
   - `PATCH /channels/:id` - Update channel
   - `DELETE /channels/:id` - Delete channel
   - `POST /channels/:id/bindings` - Create binding
   - `PATCH /channels/:id/bindings/:bid` - Update binding
   - `DELETE /channels/:id/bindings/:bid` - Delete binding

6. **UX Considerations**
   - Show webhook URL that user needs to configure in Slack
   - Warning banner if server is running on localhost (webhooks won't work)
   - Link to Slack app setup documentation
   - Credential fields should be masked and only editable, not readable

---
