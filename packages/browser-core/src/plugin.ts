/**
 * Browser tools plugin for Ants Agent.
 */
import { definePlugin } from "@ants/agent-core";
import { sandboxBrowserTools } from "./tool-factory.js";
import type { BrowserController } from "./types.js";

// Re-export for backwards compatibility
export { sandboxBrowserTools } from "./tool-factory.js";

/**
 * Create a sandbox browser plugin.
 *
 * Sandbox browsers are isolated - they have no access to user credentials or sessions.
 * Use for automated tasks, scraping, testing, etc.
 *
 * Tools are prefixed with "browser_" (e.g., browser_create, browser_navigate)
 *
 * @example
 * ```typescript
 * import { chromium } from "playwright-core";
 * import { createSandboxBrowserPlugin } from "@ants/agent-browser-core";
 * import { createSandboxController } from "@ants/agent-browser-sandbox";
 *
 * const controller = createSandboxController(chromium, { headless: true });
 * await agent.use(createSandboxBrowserPlugin(controller));
 * ```
 */
export function createSandboxBrowserPlugin(controller: BrowserController) {
  return definePlugin({
    name: "browser-sandbox",
    version: "0.1.0",
    tools: sandboxBrowserTools,
    onRegister(agent) {
      agent.setExtension("sandboxBrowserController", controller);
    },
    async onShutdown() {
      await controller.closeAll();
    },
  });
}

