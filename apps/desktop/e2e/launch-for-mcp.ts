#!/usr/bin/env npx tsx
/**
 * Launch the Ants Electron app with CDP remote debugging enabled.
 *
 * This script starts the built app and keeps it running so that an AI agent
 * can connect via the @playwright/mcp server (or any other CDP client).
 *
 * Usage:
 *   npx tsx e2e/launch-for-mcp.ts              # default port 9222
 *   npx tsx e2e/launch-for-mcp.ts --port 9333  # custom port
 *   pnpm launch:mcp                            # via npm script
 *
 * Then configure your AI agent's MCP server:
 *   {
 *     "mcpServers": {
 *       "desktop-testing": {
 *         "command": "npx",
 *         "args": ["@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
 *       }
 *     }
 *   }
 *
 * The agent can then use browser_snapshot, browser_click, browser_type, etc.
 * against the live Electron renderer.
 *
 * Press Ctrl+C to stop the app.
 */

import { launchApp, closeApp } from './electron';

const DEFAULT_PORT = 9222;

function parsePort(): number {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1 && process.argv[idx + 1]) {
    const port = parseInt(process.argv[idx + 1], 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`Invalid port: ${process.argv[idx + 1]}`);
      process.exit(1);
    }
    return port;
  }
  return DEFAULT_PORT;
}

async function main() {
  const port = parsePort();

  console.log(`Launching Ants with CDP remote debugging on port ${port}...`);
  console.log('The app must be built first (pnpm build).\n');

  const { app } = await launchApp({ cdpPort: port });

  console.log(`Ants is running.`);
  console.log(`CDP endpoint: http://localhost:${port}`);
  console.log(`\nConnect an AI agent with:`);
  console.log(`  npx @playwright/mcp@latest --cdp-endpoint http://localhost:${port}\n`);
  console.log('Press Ctrl+C to stop.\n');

  // Keep the process alive until Ctrl+C
  const shutdown = async () => {
    console.log('\nShutting down...');
    await closeApp(app);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Also shut down if the Electron app closes on its own
  app.on('close', () => {
    console.log('Electron app closed.');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to launch:', err);
  process.exit(1);
});
