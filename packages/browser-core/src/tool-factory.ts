/**
 * Browser tool factory.
 *
 * Creates browser tools with a configurable prefix and extension key.
 * This allows having separate tool sets for sandbox vs user browser.
 */
import { defineTool } from "@ants/agent-core";
import { z } from "zod";
import { appendFileSync } from "node:fs";
import type { BrowserController } from "./types.js";

// Debug logging
const LOG_FILE = '/tmp/ants-debug.log';
function debugLog(msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [browser-tools] ${msg}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore
  }
}

export interface BrowserToolFactoryOptions {
  /** Tool name prefix (e.g., "browser" for browser_create) */
  prefix: string;
  /** Key to use for looking up controller in ctx.extensions */
  extensionKey: string;
  /** Description prefix (e.g., "sandbox browser") */
  descriptionPrefix: string;
  /** Tag for the tools */
  tag: string;
}

// Helper to get browser controller from context
function getController(ctx: { extensions: Record<string, unknown> }, extensionKey: string, prefix: string): BrowserController {
  const controller = ctx.extensions[extensionKey] as BrowserController | undefined;
  if (!controller) {
    throw new Error(
      `No browser controller available for "${prefix}" tools. ` +
      `Make sure to register the appropriate browser plugin.`
    );
  }
  return controller;
}

/**
 * Create a set of browser tools with a specific prefix.
 */
export function createBrowserTools(options: BrowserToolFactoryOptions) {
  const { prefix, extensionKey, descriptionPrefix, tag } = options;
  const tags = [tag];
  const get = (ctx: { extensions: Record<string, unknown> }) => getController(ctx, extensionKey, prefix);

  const tools = [
    // Lifecycle
    defineTool({
      name: `${prefix}_create`,
      description: `Create a new ${descriptionPrefix} instance. Returns a browser ID to use with other ${prefix}_* tools.`,
      tags,
      parameters: z.object({
        url: z.string().url().optional().describe("Initial URL to navigate to"),
        width: z.number().positive().optional().describe("Viewport width in pixels"),
        height: z.number().positive().optional().describe("Viewport height in pixels"),
      }),
      execute: async (params, ctx) => {
        debugLog(`${prefix}_create called with params: ${JSON.stringify(params)}`);
        debugLog(`Available extensions: ${Object.keys(ctx.extensions).join(', ')}`);
        const controller = get(ctx);
        debugLog(`Got controller, calling create...`);
        const instance = await controller.create(params);
        debugLog(`Browser created with ID: ${instance.id}`);
        return {
          output: {
            browserId: instance.id,
            url: instance.url,
            title: instance.title,
            message: `${descriptionPrefix} created with ID: ${instance.id}`,
          },
        };
      },
    }),

    defineTool({
      name: `${prefix}_close`,
      description: `Close a ${descriptionPrefix} instance.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser to close"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        await controller.close(params.browserId);
        return {
          output: { message: `${descriptionPrefix} ${params.browserId} closed` },
        };
      },
    }),

    defineTool({
      name: `${prefix}_list`,
      description: `List all open ${descriptionPrefix} instances.`,
      tags,
      parameters: z.object({}),
      execute: async (_params, ctx) => {
        const controller = get(ctx);
        const instances = controller.getAll();
        return {
          output: {
            browsers: instances.map((b) => ({
              id: b.id,
              url: b.url,
              title: b.title,
              loading: b.loading,
            })),
            count: instances.length,
          },
        };
      },
    }),

    // Navigation
    defineTool({
      name: `${prefix}_navigate`,
      description: `Navigate a ${descriptionPrefix} to a URL.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        url: z.string().url().describe("URL to navigate to"),
        timeout: z.number().positive().optional().describe("Timeout in milliseconds"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        await controller.navigate(params.browserId, params.url, {
          timeout: params.timeout,
        });
        const url = await controller.getUrl(params.browserId);
        const title = await controller.getTitle(params.browserId);
        return {
          output: { url, title, message: `Navigated to ${url}` },
        };
      },
    }),

    defineTool({
      name: `${prefix}_go_back`,
      description: `Go back in ${descriptionPrefix} history.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        timeout: z.number().positive().optional().describe("Timeout in milliseconds"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        await controller.goBack(params.browserId, { timeout: params.timeout });
        const url = await controller.getUrl(params.browserId);
        return {
          output: { url, message: `Went back to ${url}` },
        };
      },
    }),

    defineTool({
      name: `${prefix}_go_forward`,
      description: `Go forward in ${descriptionPrefix} history.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        timeout: z.number().positive().optional().describe("Timeout in milliseconds"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        await controller.goForward(params.browserId, { timeout: params.timeout });
        const url = await controller.getUrl(params.browserId);
        return {
          output: { url, message: `Went forward to ${url}` },
        };
      },
    }),

    defineTool({
      name: `${prefix}_reload`,
      description: `Reload the current page in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        timeout: z.number().positive().optional().describe("Timeout in milliseconds"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        await controller.reload(params.browserId, { timeout: params.timeout });
        return {
          output: { message: "Page reloaded" },
        };
      },
    }),

    // Page Information
    defineTool({
      name: `${prefix}_get_url`,
      description: `Get the current URL of a ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        const url = await controller.getUrl(params.browserId);
        const title = await controller.getTitle(params.browserId);
        return {
          output: { url, title },
        };
      },
    }),

    defineTool({
      name: `${prefix}_get_content`,
      description: `Get the HTML content of the current page in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        const content = await controller.getContent(params.browserId);
        const url = await controller.getUrl(params.browserId);
        return {
          output: {
            url,
            content,
            length: content.length,
          },
        };
      },
    }),

    defineTool({
      name: `${prefix}_screenshot`,
      description: `Take a screenshot of the current page in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        format: z.enum(["png", "jpeg", "webp"]).optional().describe("Image format (default: png)"),
        quality: z.number().min(0).max(100).optional().describe("JPEG/WebP quality (0-100)"),
        fullPage: z.boolean().optional().describe("Capture full scrollable page"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        const { browserId, ...opts } = params;
        const result = await controller.screenshot(browserId, opts);
        const url = await controller.getUrl(browserId);
        return {
          output: `[Took a screenshot of ${url} (${result.width}x${result.height})]`,
          metadata: {
            image: {
              dataUrl: `data:image/${result.format};base64,${result.data}`,
              width: result.width,
              height: result.height,
            },
          },
        };
      },
    }),

    // Element Interaction
    defineTool({
      name: `${prefix}_click`,
      description: `Click on an element in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        selector: z.string().describe("CSS selector for the element to click"),
        button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default: left)"),
        clickCount: z.number().positive().optional().describe("Number of clicks (default: 1)"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        const { browserId, selector, ...opts } = params;
        await controller.click(browserId, selector, opts);
        return {
          output: { message: `Clicked on ${selector}` },
        };
      },
    }),

    defineTool({
      name: `${prefix}_type`,
      description: `Type text into an input element in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        selector: z.string().describe("CSS selector for the input element"),
        text: z.string().describe("Text to type"),
        clear: z.boolean().optional().describe("Clear the input first (default: false)"),
        delay: z.number().nonnegative().optional().describe("Delay between key presses in ms"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        const { browserId, selector, text, ...opts } = params;
        await controller.type(browserId, selector, text, opts);
        return {
          output: { message: `Typed "${text}" into ${selector}` },
        };
      },
    }),

    defineTool({
      name: `${prefix}_select`,
      description: `Select an option from a dropdown in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        selector: z.string().describe("CSS selector for the select element"),
        value: z.union([z.string(), z.array(z.string())]).describe("Value(s) to select"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        await controller.select(params.browserId, params.selector, params.value);
        return {
          output: { message: `Selected ${JSON.stringify(params.value)} in ${params.selector}` },
        };
      },
    }),

    defineTool({
      name: `${prefix}_check`,
      description: `Check or uncheck a checkbox in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        selector: z.string().describe("CSS selector for the checkbox"),
        checked: z.boolean().describe("Whether to check (true) or uncheck (false)"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        await controller.check(params.browserId, params.selector, params.checked);
        return {
          output: { message: `${params.checked ? "Checked" : "Unchecked"} ${params.selector}` },
        };
      },
    }),

    defineTool({
      name: `${prefix}_hover`,
      description: `Hover over an element in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        selector: z.string().describe("CSS selector for the element"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        await controller.hover(params.browserId, params.selector);
        return {
          output: { message: `Hovering over ${params.selector}` },
        };
      },
    }),

    defineTool({
      name: `${prefix}_scroll`,
      description: `Scroll in ${descriptionPrefix} to an element or position.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        selector: z.string().optional().describe("CSS selector to scroll to"),
        x: z.number().optional().describe("X position to scroll to (if no selector)"),
        y: z.number().optional().describe("Y position to scroll to (if no selector)"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        const { browserId, ...opts } = params;
        await controller.scroll(browserId, opts);
        return {
          output: {
            message: opts.selector
              ? `Scrolled to ${opts.selector}`
              : `Scrolled to (${opts.x ?? 0}, ${opts.y ?? 0})`,
          },
        };
      },
    }),

    // Element Queries
    defineTool({
      name: `${prefix}_query`,
      description: `Query an element for information in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        selector: z.string().describe("CSS selector for the element"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        const info = await controller.querySelector(params.browserId, params.selector);
        return {
          output: info,
        };
      },
    }),

    defineTool({
      name: `${prefix}_query_all`,
      description: `Query all elements matching a selector in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        selector: z.string().describe("CSS selector"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        const elements = await controller.querySelectorAll(params.browserId, params.selector);
        return {
          output: {
            count: elements.length,
            elements,
          },
        };
      },
    }),

    defineTool({
      name: `${prefix}_wait_for`,
      description: `Wait for an element to appear in ${descriptionPrefix}.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        selector: z.string().describe("CSS selector to wait for"),
        timeout: z.number().positive().optional().describe("Timeout in milliseconds (default: 30000)"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        const { browserId, selector, timeout } = params;
        const info = await controller.waitForSelector(browserId, selector, { timeout });
        return {
          output: {
            found: info.exists,
            element: info,
          },
        };
      },
    }),

    // JavaScript
    defineTool({
      name: `${prefix}_evaluate`,
      description: `Execute JavaScript in ${descriptionPrefix} page context.`,
      tags,
      parameters: z.object({
        browserId: z.string().describe("ID of the browser"),
        script: z.string().describe("JavaScript code to execute (function body)"),
      }),
      execute: async (params, ctx) => {
        const controller = get(ctx);
        const result = await controller.evaluate(params.browserId, params.script);
        return {
          output: { result },
        };
      },
    }),
  ];

  return tools;
}

/**
 * Pre-configured sandbox browser tools.
 * Uses "browser_*" prefix and "sandboxBrowserController" extension.
 */
export const sandboxBrowserTools = createBrowserTools({
  prefix: "browser",
  extensionKey: "sandboxBrowserController",
  descriptionPrefix: "sandbox browser",
  tag: "browser",
});
