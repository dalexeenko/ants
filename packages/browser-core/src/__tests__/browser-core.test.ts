import { describe, it, expect } from "vitest";
import {
  BrowserCreateOptionsSchema,
  ScreenshotOptionsSchema,
  ClickOptionsSchema,
  TypeOptionsSchema,
  WaitOptionsSchema,
  ScrollOptionsSchema,
  sandboxBrowserTools,
  createBrowserTools,
  createSandboxBrowserPlugin,
} from "../index.js";

// ---------------------------------------------------------------------------
// 1. Zod schema validation
// ---------------------------------------------------------------------------

describe("Zod schemas", () => {
  it("BrowserCreateOptionsSchema accepts valid input", () => {
    const result = BrowserCreateOptionsSchema.parse({ url: "https://example.com" });
    expect(result).toEqual({ url: "https://example.com" });
  });

  it("BrowserCreateOptionsSchema accepts undefined (optional root)", () => {
    const result = BrowserCreateOptionsSchema.parse(undefined);
    expect(result).toBeUndefined();
  });

  it("ScreenshotOptionsSchema accepts valid input", () => {
    const result = ScreenshotOptionsSchema.parse({ format: "png", fullPage: true });
    expect(result).toEqual({ format: "png", fullPage: true });
  });

  it("ScreenshotOptionsSchema accepts empty object", () => {
    const result = ScreenshotOptionsSchema.parse({});
    expect(result).toEqual({});
  });

  it("ScreenshotOptionsSchema accepts undefined (optional root)", () => {
    const result = ScreenshotOptionsSchema.parse(undefined);
    expect(result).toBeUndefined();
  });

  it("ClickOptionsSchema accepts valid input", () => {
    const result = ClickOptionsSchema.parse({ button: "left", clickCount: 2 });
    expect(result).toEqual({ button: "left", clickCount: 2 });
  });

  it("ClickOptionsSchema accepts empty object", () => {
    const result = ClickOptionsSchema.parse({});
    expect(result).toEqual({});
  });

  it("TypeOptionsSchema accepts valid input", () => {
    const result = TypeOptionsSchema.parse({ delay: 50, clear: true });
    expect(result).toEqual({ delay: 50, clear: true });
  });

  it("TypeOptionsSchema accepts empty object", () => {
    const result = TypeOptionsSchema.parse({});
    expect(result).toEqual({});
  });

  it("WaitOptionsSchema accepts valid input", () => {
    const result = WaitOptionsSchema.parse({ timeout: 5000 });
    expect(result).toEqual({ timeout: 5000 });
  });

  it("WaitOptionsSchema accepts undefined (optional root)", () => {
    const result = WaitOptionsSchema.parse(undefined);
    expect(result).toBeUndefined();
  });

  it("ScrollOptionsSchema accepts valid input", () => {
    const result = ScrollOptionsSchema.parse({ selector: ".loading" });
    expect(result).toEqual({ selector: ".loading" });
  });

  it("ScrollOptionsSchema accepts empty object", () => {
    const result = ScrollOptionsSchema.parse({});
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 2. sandboxBrowserTools
// ---------------------------------------------------------------------------

describe("sandboxBrowserTools", () => {
  it("is an array of tool definitions", () => {
    expect(Array.isArray(sandboxBrowserTools)).toBe(true);
    expect(sandboxBrowserTools.length).toBeGreaterThan(0);
  });

  it("each tool has name, description, parameters, and execute", () => {
    for (const tool of sandboxBrowserTools) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("parameters");
      expect(tool).toHaveProperty("execute");
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("all tool names start with browser_", () => {
    for (const tool of sandboxBrowserTools) {
      expect(tool.name).toMatch(/^browser_/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. createBrowserTools
// ---------------------------------------------------------------------------

describe("createBrowserTools", () => {
  it("returns an array of tool definitions with the given prefix", () => {
    const tools = createBrowserTools({
      prefix: "test_browser",
      extensionKey: "testController",
      descriptionPrefix: "test browser",
      tag: "test",
    });

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    for (const tool of tools) {
      expect(tool.name).toMatch(/^test_browser_/);
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("parameters");
      expect(tool).toHaveProperty("execute");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. createSandboxBrowserPlugin
// ---------------------------------------------------------------------------

describe("createSandboxBrowserPlugin", () => {
  const mockController = {
    create: async () => {},
    close: async () => {},
    closeAll: async () => {},
    get: () => undefined,
    getAll: () => [],
    platform: "sandbox",
  } as any;

  it("returns a plugin object with name, version, and tools", () => {
    const plugin = createSandboxBrowserPlugin(mockController);

    expect(plugin).toHaveProperty("name", "browser-sandbox");
    expect(plugin).toHaveProperty("version", "0.1.0");
    expect(plugin).toHaveProperty("tools");
    expect(Array.isArray(plugin.tools)).toBe(true);
    expect(plugin.tools!.length).toBeGreaterThan(0);
  });

  it("plugin tools match sandboxBrowserTools", () => {
    const plugin = createSandboxBrowserPlugin(mockController);
    expect(plugin.tools).toBe(sandboxBrowserTools);
  });

  it("has onRegister and onShutdown hooks", () => {
    const plugin = createSandboxBrowserPlugin(mockController);
    expect(typeof plugin.onRegister).toBe("function");
    expect(typeof plugin.onShutdown).toBe("function");
  });
});
