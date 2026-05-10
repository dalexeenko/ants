---
title: Slack Integration
description: Set up Slack to interact with your OpenMgr agents via mentions and direct messages.
sidebar:
  order: 4
---

Connect your OpenMgr agents to Slack so users can interact with them via @mentions and direct messages.

## Prerequisites

- OpenMgr server running and accessible from the internet (see [Exposing Your Server](#exposing-your-server) below)
- A Slack workspace where you have permission to create apps

## Step 1: Create a Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Enter an app name (e.g., "OpenMgr Agent")
4. Select your workspace and click **Create App**

## Step 2: Configure Bot Token Scopes

1. Navigate to **OAuth & Permissions** in the sidebar
2. Under **Bot Token Scopes**, add:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Receive @mentions in channels |
| `chat:write` | Send messages |
| `im:history` | Read DM history for context |
| `im:read` | Access DM metadata |
| `im:write` | Start DMs with users |
| `reactions:read` | Read reactions |
| `reactions:write` | Add reactions (typing indicators) |

## Step 3: Enable Event Subscriptions

1. Go to **Event Subscriptions** in the sidebar
2. Toggle **Enable Events** to On
3. Set the **Request URL** to:
   ```
   https://your-server.com/channels/slack/events
   ```
   Slack will send a verification request — your server must be running and accessible.

4. Under **Subscribe to bot events**, add:
   - `app_mention` — Triggers on @mentions
   - `message.im` — Triggers on direct messages

5. Click **Save Changes**

## Step 4: Install and Get Credentials

1. Go to **OAuth & Permissions** > **Install to Workspace** > **Allow**
2. Copy the **Bot User OAuth Token** (`xoxb-...`)
3. Go to **Basic Information** > **App Credentials** > copy the **Signing Secret**
4. In Slack, find your bot and copy its **Member ID** (`U0XXXXXXXX`)

## Step 5: Configure OpenMgr

### Via API

```bash
# Create the Slack channel
curl -X POST http://localhost:6647/channels \
  -H "Authorization: Bearer $OPENMGR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "slack",
    "name": "My Workspace",
    "config": {
      "workspaceId": "T0XXXXXXXX",
      "workspaceName": "My Workspace",
      "botUserId": "U0XXXXXXXX"
    },
    "credentials": {
      "botToken": "xoxb-...",
      "signingSecret": "..."
    }
  }'

# Create a binding to connect the channel to a project
curl -X POST http://localhost:6647/channels/CHANNEL_ID/bindings \
  -H "Authorization: Bearer $OPENMGR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "your-project-id",
    "triggerConfig": {
      "events": ["mention", "direct_message"]
    },
    "responseConfig": {
      "threadBehavior": "always",
      "typingIndicator": true
    }
  }'
```

### Via the Web UI

1. Navigate to **Channels** in the OpenMgr UI
2. Click **Add Channel** > Select **Slack**
3. Enter your credentials and configuration
4. Create a binding to connect it to a project

## Step 6: Test It

Send a direct message to your bot in Slack, or @mention it in a channel:

```
@OpenMgr Agent what can you help me with?
```

The bot should respond within a few seconds.

## Exposing Your Server

Slack needs to reach your server via HTTPS. Options:

### ngrok (development)

```bash
ngrok http 6647
# Use the https URL in Slack's Event Subscriptions
```

### Cloudflare Tunnel (production)

```bash
cloudflared tunnel create openmgr
cloudflared tunnel route dns openmgr openmgr.yourdomain.com
cloudflared tunnel run openmgr
```

### Reverse Proxy (production)

See the [Production Hardening guide](/guides/production/) for Caddy and nginx configurations.

## Troubleshooting

### "URL verification failed"
- Ensure your server is running and accessible from the internet
- Verify the URL includes `/channels/slack/events`
- Check server logs for incoming requests

### Bot doesn't respond
1. Check server logs for incoming webhook events
2. Verify the signing secret is correct
3. Ensure the channel is enabled and has a binding to a project
4. Check that the project's agent is running

### "dispatch_failed" errors
Slack couldn't reach your server within 3 seconds. Check server accessibility and network latency.

### Formatting issues
The server converts between standard Markdown and Slack's mrkdwn format automatically. If you see conversion issues, report them with example input/output.

## Security

- Never commit Bot Tokens or Signing Secrets to version control
- Always use HTTPS for webhook URLs in production
- The server verifies all incoming webhooks using the Signing Secret (HMAC-SHA256)
- Use the `allowedChannels` config to limit which Slack channels can trigger the bot
