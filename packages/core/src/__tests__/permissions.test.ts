/**
 * Tests for tool permission system
 */
import { describe, it, expect, vi } from "vitest";
import {
  ToolPermissionManager,
  createReadOnlyConfig,
  createStrictConfig,
  createPermissiveConfig,
  SAFE_READ_TOOLS,
  WRITE_TOOLS,
} from "../permissions.js";
import type { ToolCall } from "../types.js";

function createToolCall(name: string): ToolCall {
  return {
    id: `call-${name}`,
    name,
    arguments: {},
  };
}

describe("ToolPermissionManager", () => {
  describe("default configuration", () => {
    it("should default to ask mode", () => {
      const manager = new ToolPermissionManager();
      expect(manager.getPermissionDecision("any_tool")).toBe("ask");
    });
  });

  describe("allowAll configuration", () => {
    it("should allow all tools when allowAll is true", () => {
      const manager = new ToolPermissionManager({ allowAll: true });
      
      expect(manager.getPermissionDecision("bash")).toBe("allow");
      expect(manager.getPermissionDecision("write")).toBe("allow");
      expect(manager.getPermissionDecision("any_tool")).toBe("allow");
    });
  });

  describe("alwaysAllow patterns", () => {
    it("should allow tools matching exact names", () => {
      const manager = new ToolPermissionManager({
        alwaysAllow: ["read", "glob"],
      });
      
      expect(manager.getPermissionDecision("read")).toBe("allow");
      expect(manager.getPermissionDecision("glob")).toBe("allow");
      expect(manager.getPermissionDecision("write")).toBe("ask");
    });

    it("should allow tools matching glob patterns with trailing *", () => {
      const manager = new ToolPermissionManager({
        alwaysAllow: ["mcp_*"],
      });
      
      expect(manager.getPermissionDecision("mcp_github_create_issue")).toBe("allow");
      expect(manager.getPermissionDecision("mcp_filesystem_read")).toBe("allow");
      expect(manager.getPermissionDecision("bash")).toBe("ask");
    });

    it("should allow tools matching glob patterns with leading *", () => {
      const manager = new ToolPermissionManager({
        alwaysAllow: ["*_read"],
      });
      
      expect(manager.getPermissionDecision("file_read")).toBe("allow");
      expect(manager.getPermissionDecision("todo_read")).toBe("allow");
      expect(manager.getPermissionDecision("file_write")).toBe("ask");
    });

    it("should allow all tools with * pattern", () => {
      const manager = new ToolPermissionManager({
        alwaysAllow: ["*"],
      });
      
      expect(manager.getPermissionDecision("anything")).toBe("allow");
    });
  });

  describe("alwaysDeny patterns", () => {
    it("should deny tools matching patterns", () => {
      const manager = new ToolPermissionManager({
        alwaysDeny: ["bash", "write"],
      });
      
      expect(manager.getPermissionDecision("bash")).toBe("deny");
      expect(manager.getPermissionDecision("write")).toBe("deny");
      expect(manager.getPermissionDecision("read")).toBe("ask");
    });

    it("should prioritize deny over allow", () => {
      const manager = new ToolPermissionManager({
        alwaysAllow: ["*"],
        alwaysDeny: ["bash"],
      });
      
      expect(manager.getPermissionDecision("bash")).toBe("deny");
      expect(manager.getPermissionDecision("read")).toBe("allow");
    });
  });

  describe("session-level permissions", () => {
    it("should allow tools added for session", () => {
      const manager = new ToolPermissionManager();
      
      manager.allowForSession("bash");
      expect(manager.getPermissionDecision("bash")).toBe("allow");
      expect(manager.isAllowedForSession("bash")).toBe(true);
    });

    it("should deny tools denied for session", () => {
      const manager = new ToolPermissionManager();
      
      manager.denyForSession("bash");
      expect(manager.getPermissionDecision("bash")).toBe("deny");
      expect(manager.isDeniedForSession("bash")).toBe(true);
    });

    it("should clear session permissions", () => {
      const manager = new ToolPermissionManager();
      
      manager.allowForSession("bash");
      manager.denyForSession("write");
      
      manager.clearSessionPermissions();
      
      expect(manager.getPermissionDecision("bash")).toBe("ask");
      expect(manager.getPermissionDecision("write")).toBe("ask");
      expect(manager.getSessionAllowed()).toHaveLength(0);
      expect(manager.getSessionDenied()).toHaveLength(0);
    });

    it("should override config deny with session allow", () => {
      const manager = new ToolPermissionManager({
        alwaysDeny: ["bash"],
      });
      
      // Config says deny, but session allows
      manager.allowForSession("bash");
      expect(manager.getPermissionDecision("bash")).toBe("allow");
    });

    it("should list session allowed/denied tools", () => {
      const manager = new ToolPermissionManager();
      
      manager.allowForSession("read");
      manager.allowForSession("glob");
      manager.denyForSession("bash");
      
      expect(manager.getSessionAllowed()).toEqual(["read", "glob"]);
      expect(manager.getSessionDenied()).toEqual(["bash"]);
    });
  });

  describe("checkPermission with callback", () => {
    it("should call callback for ask decisions", async () => {
      const manager = new ToolPermissionManager();
      const callback = vi.fn().mockResolvedValue("allow_once");
      manager.setRequestCallback(callback);

      const toolCall = createToolCall("bash");
      const result = await manager.checkPermission(toolCall);

      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith(toolCall);
    });

    it("should add to session allowed on allow_always response", async () => {
      const manager = new ToolPermissionManager();
      manager.setRequestCallback(vi.fn().mockResolvedValue("allow_always"));

      await manager.checkPermission(createToolCall("bash"));

      expect(manager.isAllowedForSession("bash")).toBe(true);
      // Subsequent checks should not call callback
      const callback2 = vi.fn();
      manager.setRequestCallback(callback2);
      const result = await manager.checkPermission(createToolCall("bash"));
      expect(result).toBe(true);
      expect(callback2).not.toHaveBeenCalled();
    });

    it("should deny on deny response", async () => {
      const manager = new ToolPermissionManager();
      manager.setRequestCallback(vi.fn().mockResolvedValue("deny"));

      const result = await manager.checkPermission(createToolCall("bash"));

      expect(result).toBe(false);
      // Should not add to session denied (user might want to allow next time)
      expect(manager.isDeniedForSession("bash")).toBe(false);
    });

    it("should deny when no callback is set", async () => {
      const manager = new ToolPermissionManager();
      // No callback set

      const result = await manager.checkPermission(createToolCall("bash"));

      expect(result).toBe(false);
    });

    it("should not call callback for allowed tools", async () => {
      const manager = new ToolPermissionManager({
        alwaysAllow: ["read"],
      });
      const callback = vi.fn();
      manager.setRequestCallback(callback);

      const result = await manager.checkPermission(createToolCall("read"));

      expect(result).toBe(true);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should not call callback for denied tools", async () => {
      const manager = new ToolPermissionManager({
        alwaysDeny: ["bash"],
      });
      const callback = vi.fn();
      manager.setRequestCallback(callback);

      const result = await manager.checkPermission(createToolCall("bash"));

      expect(result).toBe(false);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", () => {
      const manager = new ToolPermissionManager();
      
      manager.updateConfig({ alwaysAllow: ["read"] });
      expect(manager.getPermissionDecision("read")).toBe("allow");
      
      manager.updateConfig({ allowAll: true });
      expect(manager.getPermissionDecision("anything")).toBe("allow");
    });

    it("should merge with existing config", () => {
      const manager = new ToolPermissionManager({
        alwaysAllow: ["read"],
      });
      
      manager.updateConfig({ alwaysDeny: ["bash"] });
      
      expect(manager.getPermissionDecision("read")).toBe("allow");
      expect(manager.getPermissionDecision("bash")).toBe("deny");
    });
  });
});

describe("preset configurations", () => {
  describe("createReadOnlyConfig", () => {
    it("should allow safe read tools", () => {
      const config = createReadOnlyConfig();
      const manager = new ToolPermissionManager(config);
      
      for (const tool of SAFE_READ_TOOLS) {
        expect(manager.getPermissionDecision(tool)).toBe("allow");
      }
    });

    it("should ask for write tools", () => {
      const config = createReadOnlyConfig();
      const manager = new ToolPermissionManager(config);
      
      for (const tool of WRITE_TOOLS) {
        expect(manager.getPermissionDecision(tool)).toBe("ask");
      }
    });
  });

  describe("createStrictConfig", () => {
    it("should ask for all tools", () => {
      const config = createStrictConfig();
      const manager = new ToolPermissionManager(config);
      
      expect(manager.getPermissionDecision("read")).toBe("ask");
      expect(manager.getPermissionDecision("bash")).toBe("ask");
      expect(manager.getPermissionDecision("anything")).toBe("ask");
    });
  });

  describe("createPermissiveConfig", () => {
    it("should allow all tools", () => {
      const config = createPermissiveConfig();
      const manager = new ToolPermissionManager(config);
      
      expect(manager.getPermissionDecision("read")).toBe("allow");
      expect(manager.getPermissionDecision("bash")).toBe("allow");
      expect(manager.getPermissionDecision("anything")).toBe("allow");
    });
  });
});

describe("SAFE_READ_TOOLS and WRITE_TOOLS constants", () => {
  it("should contain expected safe tools", () => {
    // Filesystem read-only
    expect(SAFE_READ_TOOLS).toContain("read");
    expect(SAFE_READ_TOOLS).toContain("glob");
    expect(SAFE_READ_TOOLS).toContain("grep");
    // Session state (in-memory)
    expect(SAFE_READ_TOOLS).toContain("todoread");
    expect(SAFE_READ_TOOLS).toContain("todowrite");
    expect(SAFE_READ_TOOLS).toContain("phaseread");
    expect(SAFE_READ_TOOLS).toContain("phasewrite");
    // Informational
    expect(SAFE_READ_TOOLS).toContain("skill");
    expect(SAFE_READ_TOOLS).toContain("question");
    expect(SAFE_READ_TOOLS).toContain("task_status");
    // Network read-only
    expect(SAFE_READ_TOOLS).toContain("web_fetch");
    expect(SAFE_READ_TOOLS).toContain("web_search");
  });

  it("should NOT contain write/edit/bash tools", () => {
    expect(SAFE_READ_TOOLS).not.toContain("write");
    expect(SAFE_READ_TOOLS).not.toContain("edit");
    expect(SAFE_READ_TOOLS).not.toContain("bash");
    expect(SAFE_READ_TOOLS).not.toContain("task");
  });

  it("should contain expected write tools", () => {
    expect(WRITE_TOOLS).toContain("bash");
    expect(WRITE_TOOLS).toContain("write");
    expect(WRITE_TOOLS).toContain("edit");
  });
});
