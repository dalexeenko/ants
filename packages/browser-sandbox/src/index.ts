/**
 * @openmgr/agent-browser-sandbox
 *
 * Sandbox browser controller using Playwright with bundled Chromium.
 * Creates isolated browser sessions without access to user's credentials or data.
 *
 * Tools are tagged with "browser" and prefixed with "browser_".
 *
 * ## Usage
 *
 * ```typescript
 * import { createSandboxController, createSandboxBrowserPlugin } from "@openmgr/agent-browser-sandbox";
 * import { createAgent } from "@openmgr/agent-core";
 *
 * // Create the controller - uses Playwright's bundled Chromium
 * const controller = createSandboxController({ headless: false });
 *
 * // Create the agent with browser support
 * const agent = await createAgent({ ... });
 * await agent.use(createSandboxBrowserPlugin(controller));
 *
 * // Now the agent can use browser_* tools
 * await agent.prompt("Open a browser and go to https://example.com");
 * ```
 */

export {
  SandboxBrowserController,
  createSandboxController,
  type SandboxControllerOptions,
  type SetupEvent,
} from "./controller.js";

export type {
  BrowserController,
  BrowserInstance,
  BrowserCreateOptions,
  BrowserControllerOptions,
  BrowserEvent,
} from "@openmgr/agent-browser-core";

export {
  createSandboxBrowserPlugin,
  sandboxBrowserTools,
} from "@openmgr/agent-browser-core";
