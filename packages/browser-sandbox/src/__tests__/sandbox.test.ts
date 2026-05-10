import { describe, it, expect } from "vitest";
import {
  SandboxBrowserController,
  createSandboxController,
  createSandboxBrowserPlugin,
  sandboxBrowserTools,
} from "../index.js";

describe("createSandboxController", () => {
  it("returns a SandboxBrowserController instance", () => {
    const controller = createSandboxController();
    expect(controller).toBeInstanceOf(SandboxBrowserController);
  });

  it("passes options through to the controller", () => {
    const controller = createSandboxController({ headless: true });
    expect(controller).toBeInstanceOf(SandboxBrowserController);
    expect(controller.platform).toBe("sandbox");
  });
});

describe("SandboxBrowserController", () => {
  it("has platform set to 'sandbox'", () => {
    const controller = new SandboxBrowserController();
    expect(controller.platform).toBe("sandbox");
  });

  it("getAll() returns empty array initially", () => {
    const controller = new SandboxBrowserController();
    expect(controller.getAll()).toEqual([]);
  });

  it("get() returns undefined for nonexistent browser", () => {
    const controller = new SandboxBrowserController();
    expect(controller.get("nonexistent")).toBeUndefined();
  });

  it("accepts options in constructor without error", () => {
    const controller = new SandboxBrowserController({
      headless: true,
      defaultViewport: { width: 1024, height: 768 },
      defaultTimeout: 5000,
    });
    expect(controller.platform).toBe("sandbox");
    expect(controller.getAll()).toEqual([]);
  });
});

describe("exports", () => {
  it("SandboxBrowserController is a constructor function", () => {
    expect(typeof SandboxBrowserController).toBe("function");
  });

  it("createSandboxController is a function", () => {
    expect(typeof createSandboxController).toBe("function");
  });

  it("createSandboxBrowserPlugin is a function", () => {
    expect(typeof createSandboxBrowserPlugin).toBe("function");
  });

  it("sandboxBrowserTools is an array", () => {
    expect(Array.isArray(sandboxBrowserTools)).toBe(true);
    expect(sandboxBrowserTools.length).toBeGreaterThan(0);
  });
});
