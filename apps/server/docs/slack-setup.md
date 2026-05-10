# Slack Integration Setup Guide

This guide walks you through setting up Slack integration with OpenMgr, allowing you to interact with your agents via Slack mentions and direct messages.

## Prerequisites

- OpenMgr server running and accessible from the internet (see [Exposing Your Server](#exposing-your-server))
- A Slack workspace where you have permission to create apps

## Step 1: Create a Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**
3. Choose **From scratch**
4. Enter an app name (e.g., "OpenMgr Agent")
5. Select your workspace
6. Click **Create App**

## Step 2: Configure Bot Token Scopes

1. In the left sidebar, click **OAuth & Permissions**
2. Scroll down to **Scopes** > **Bot Token Scopes**
3. Add the following scopes:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Receive @mentions in channels |
| `chat:write` | Send messages |
| `im:history` | Read DM history for context |
| `im:read` | Access DM metadata |
| `im:write` | Start DMs with users |
| `reactions:read` | Read reactions (for future use) |
| `reactions:write` | Add reactions (typing indicators) |

## Step 3: Enable Event Subscriptions

1. In the left sidebar, click **Event Subscriptions**
2. Toggle **Enable Events** to On
3. In **Request URL**, enter:
   ```
   https://your-server.com/channels/slack/events
   ```
   Replace `your-server.com` with your actual server URL.
   
   Slack will send a verification request. The server must be running and accessible for this to succeed.

4. Under **Subscribe to bot events**, add:
   - `app_mention` - Triggers when someone @mentions your bot
   - `message.im` - Triggers on direct messages to your bot

5. Click **Save Changes**

## Step 4: Install App to Workspace

1. In the left sidebar, click **OAuth & Permissions**
2. Click **Install to Workspace**
3. Review the permissions and click **Allow**
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
   - Keep this secret! It grants access to your Slack workspace.

## Step 5: Get Signing Secret

1. In the left sidebar, click **Basic Information**
2. Under **App Credentials**, find **Signing Secret**
3. Click **Show** and copy the value
   - This is used to verify webhook requests are from Slack

## Step 6: Get Bot User ID

1. In Slack, go to your workspace
2. Find your bot in the Apps section or invite it to a channel
3. Click on the bot's name to view its profile
4. Click the "..." menu and select **Copy member ID**
   - This looks like `U0XXXXXXXX`

## Step 7: Configure OpenMgr

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

# Note the channel ID from the response, then create a binding
curl -X POST http://localhost:6647/channels/{channel_id}/bindings \
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

### Via App UI

1. Navigate to **Channels** in the OpenMgr app
2. Click **Add Channel**
3. Select **Slack** as the channel type
4. Enter your credentials and configuration
5. Create a binding to connect to a project

## Step 8: Test the Integration

1. In Slack, send a direct message to your bot:
   ```
   Hello!
   ```

2. Or @mention the bot in a channel:
   ```
   @OpenMgr Agent what can you help me with?
   ```

3. The bot should respond within a few seconds

## Exposing Your Server

Slack needs to send webhook events to your server, which must be accessible from the internet. Here are some options:

### Option 1: ngrok (Development)

```bash
# Install ngrok
brew install ngrok  # or download from ngrok.com

# Expose your local server
ngrok http 6647

# Use the https URL (e.g., https://abc123.ngrok.io) in Slack's Event Subscriptions
```

### Option 2: Cloudflare Tunnel (Production)

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Create a tunnel
cloudflared tunnel create openmgr

# Route traffic
cloudflared tunnel route dns openmgr openmgr.yourdomain.com

# Run the tunnel
cloudflared tunnel run openmgr
```

### Option 3: Reverse Proxy (Production)

If your server is on a VPS or cloud instance, configure nginx or Caddy:

**Caddy (automatic HTTPS):**
```
openmgr.yourdomain.com {
    reverse_proxy localhost:6647
}
```

**nginx:**
```nginx
server {
    listen 443 ssl;
    server_name openmgr.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:6647;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Troubleshooting

### Slack says "URL verification failed"

- Ensure your server is running and accessible from the internet
- Check that the URL is correct (including `/channels/slack/events`)
- Check server logs for incoming requests

### Bot doesn't respond to messages

1. Check server logs for incoming webhook events
2. Verify the signing secret is correct
3. Ensure the channel is enabled
4. Ensure there's a binding connecting the channel to a project
5. Check that the project's agent is running

### "dispatch_failed" errors in Slack

This usually means Slack couldn't reach your server within 3 seconds. Check:
- Server accessibility
- Network latency
- Server logs for processing delays

### Bot responds but formatting is wrong

The server converts between standard Markdown and Slack's mrkdwn format. If you see issues:
- Check if the agent is using unsupported Markdown features
- Report the issue with example input/output

## Security Considerations

- **Keep tokens secret**: Never commit Bot Tokens or Signing Secrets to version control
- **Use HTTPS**: Always use HTTPS for your webhook URL in production
- **Verify signatures**: The server verifies all incoming webhooks using the Signing Secret
- **Restrict channels**: Use the `allowedChannels` config to limit which Slack channels can trigger the bot

## Rate Limits

Slack has rate limits on API calls. The message queue naturally throttles outbound messages. If you hit rate limits:
- The server will retry with exponential backoff
- Check server logs for rate limit warnings
- Consider reducing the number of channels/bindings if consistently hitting limits
