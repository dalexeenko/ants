/**
 * Tests for the SubagentManager and SharedState/MessageBus.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SharedState, MessageBus } from "../subagent/shared-state.js";

// ===========================================================================
// SharedState
// ===========================================================================

describe("SharedState", () => {
  let state: SharedState;

  beforeEach(() => {
    state = new SharedState();
  });

  it("should start empty", () => {
    expect(state.size).toBe(0);
    expect(state.keys()).toEqual([]);
  });

  it("should set and get values", () => {
    state.set("key1", "value1", "writer-1");
    expect(state.get("key1")).toBe("value1");
    expect(state.has("key1")).toBe(true);
    expect(state.has("missing")).toBe(false);
  });

  it("should track metadata in entries", () => {
    state.set("key1", 42, "writer-a");
    const entry = state.getEntry<number>("key1");
    expect(entry).toBeDefined();
    expect(entry!.value).toBe(42);
    expect(entry!.updatedBy).toBe("writer-a");
    expect(entry!.version).toBe(1);
    expect(entry!.updatedAt).toBeGreaterThan(0);
  });

  it("should increment version on updates", () => {
    state.set("key1", "v1", "w");
    state.set("key1", "v2", "w");
    state.set("key1", "v3", "w");
    expect(state.getEntry("key1")!.version).toBe(3);
  });

  it("should emit change events", () => {
    const changes: Array<{ key: string; value: unknown }> = [];
    state.on("change", (entry) => changes.push({ key: entry.key, value: entry.value }));

    state.set("a", 1, "w");
    state.set("b", 2, "w");

    expect(changes).toHaveLength(2);
    expect(changes[0]!.key).toBe("a");
    expect(changes[1]!.key).toBe("b");
  });

  it("should delete entries and emit delete events", () => {
    const deletes: string[] = [];
    state.on("delete", (key) => deletes.push(key));

    state.set("x", 1, "w");
    expect(state.delete("x", "deleter")).toBe(true);
    expect(state.has("x")).toBe(false);
    expect(deletes).toEqual(["x"]);

    // Deleting nonexistent key returns false
    expect(state.delete("x", "deleter")).toBe(false);
  });

  it("should list all keys and entries", () => {
    state.set("a", 1, "w");
    state.set("b", 2, "w");
    expect(state.keys().sort()).toEqual(["a", "b"]);
    expect(state.entries()).toHaveLength(2);
  });

  it("should convert to JSON", () => {
    state.set("a", 1, "w");
    state.set("b", "hello", "w");
    expect(state.toJSON()).toEqual({ a: 1, b: "hello" });
  });

  it("should clear all entries", () => {
    state.set("a", 1, "w");
    state.set("b", 2, "w");
    state.clear();
    expect(state.size).toBe(0);
    expect(state.keys()).toEqual([]);
  });
});

// ===========================================================================
// MessageBus
// ===========================================================================

describe("MessageBus", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it("should publish and receive messages on a channel", () => {
    const received: Array<{ channel: string; payload: unknown }> = [];
    bus.subscribe("test-channel", (msg) => received.push({ channel: msg.channel, payload: msg.payload }));

    const published = bus.publish("test-channel", { data: "hello" }, "sender-1");
    expect(published.id).toBeDefined();
    expect(published.senderId).toBe("sender-1");
    expect(published.channel).toBe("test-channel");

    expect(received).toHaveLength(1);
    expect(received[0]!.payload).toEqual({ data: "hello" });
  });

  it("should not deliver messages to unrelated channels", () => {
    const received: unknown[] = [];
    bus.subscribe("channel-a", (msg) => received.push(msg));

    bus.publish("channel-b", "data", "s1");
    expect(received).toHaveLength(0);
  });

  it("should support multiple subscribers per channel", () => {
    const r1: unknown[] = [];
    const r2: unknown[] = [];
    bus.subscribe("ch", () => r1.push(1));
    bus.subscribe("ch", () => r2.push(1));

    bus.publish("ch", "x", "s");
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it("should unsubscribe correctly", () => {
    const received: unknown[] = [];
    const unsub = bus.subscribe("ch", (msg) => received.push(msg.payload));

    bus.publish("ch", "a", "s");
    unsub();
    bus.publish("ch", "b", "s");

    expect(received).toHaveLength(1);
  });

  it("should emit global message events", () => {
    const global: unknown[] = [];
    bus.on("message", (msg) => global.push(msg.payload));

    bus.publish("any-channel", "data", "s");
    expect(global).toHaveLength(1);
  });

  it("should track channel names", () => {
    bus.subscribe("a", () => {});
    bus.subscribe("b", () => {});
    expect(bus.getChannels().sort()).toEqual(["a", "b"]);
  });

  it("should clear a specific channel", () => {
    const received: unknown[] = [];
    bus.subscribe("ch", (msg) => received.push(msg));
    bus.clearChannel("ch");

    bus.publish("ch", "data", "s");
    expect(received).toHaveLength(0);
    expect(bus.getChannels()).not.toContain("ch");
  });

  it("should clear all channels", () => {
    bus.subscribe("a", () => {});
    bus.subscribe("b", () => {});
    bus.clearAll();
    expect(bus.getChannels()).toEqual([]);
  });

  it("should generate unique message IDs", () => {
    const m1 = bus.publish("ch", "a", "s");
    const m2 = bus.publish("ch", "b", "s");
    expect(m1.id).not.toBe(m2.id);
  });

  it("should clean up channel when last subscriber unsubscribes", () => {
    const unsub = bus.subscribe("ch", () => {});
    expect(bus.getChannels()).toContain("ch");
    unsub();
    expect(bus.getChannels()).not.toContain("ch");
  });
});
