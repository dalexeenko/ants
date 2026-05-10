/**
 * @ants/agent-browser-core
 *
 * Core browser controller types and tools for Ants Agent.
 * This package provides the shared interface that platform-specific
 * browser packages implement.
 *
 * ## Browser Tools
 *
 * The sandbox browser (`browser_*` tools) provides:
 * - Isolated browser with no user credentials
 * - Use for automated tasks, scraping, testing
 * - Package: `@ants/agent-browser-sandbox`
 *
 * ## Usage
 *
 * ```typescript
 * import { chromium } from "playwright-core";
 * import { createSandboxBrowserPlugin } from "@ants/agent-browser-core";
 * import { createSandboxController } from "@ants/agent-browser-sandbox";
 *
 * const controller = createSandboxController(chromium);
 * await agent.use(createSandboxBrowserPlugin(controller));
 * ```
 */

// Types
export type {
  BrowserInstance,
  BrowserCreateOptions,
  ScreenshotResult,
  ScreenshotOptions,
  ScreencastOptions,
  ElementInfo,
  WaitOptions,
  ClickOptions,
  TypeOptions,
  BrowserController,
  BrowserControllerOptions,
  BrowserEvent,
  BrowserCreatedEvent,
  BrowserNavigatedEvent,
  BrowserLoadingEvent,
  BrowserClosedEvent,
  BrowserScreenshotEvent,
  BrowserConsoleEvent,
  BrowserErrorEvent,
  BrowserScreencastStartedEvent,
  BrowserScreencastStoppedEvent,
  BrowserScreencastFrameEvent,
} from "./types.js";

// Schemas (for validation)
export {
  BrowserCreateOptionsSchema,
  ScreenshotOptionsSchema,
  ClickOptionsSchema,
  TypeOptionsSchema,
  WaitOptionsSchema,
  ScrollOptionsSchema,
} from "./types.js";

// Tool factory
export {
  createBrowserTools,
  sandboxBrowserTools,
  type BrowserToolFactoryOptions,
} from "./tool-factory.js";

// Plugins
export {
  createSandboxBrowserPlugin,
} from "./plugin.js";
