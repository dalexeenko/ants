/**
 * Tests for session title generation
 */
import { describe, it, expect, vi } from "vitest";
import { generateTitle, isDefaultTitle } from "../title.js";
import type { LLMProvider, Message } from "../types.js";

// Mock provider for testing
function createMockProvider(responseContent: string): LLMProvider {
  return {
    stream: vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield { type: "text", text: responseContent };
      })(),
      response: Promise.resolve({
        content: responseContent,
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    }),
  };
}

describe("generateTitle", () => {
  it("should generate a title from user message", async () => {
    const mockProvider = createMockProvider("Debug production 500 errors");
    
    const messages: Message[] = [
      { id: "1", role: "user", content: "Help me debug 500 errors in production", createdAt: Date.now() },
    ];

    const title = await generateTitle(messages, {
      provider: mockProvider,
      model: "test-model",
    });

    expect(title).toBe("Debug production 500 errors");
    expect(mockProvider.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        temperature: 0.5,
      })
    );
  });

  it("should use context from first few messages", async () => {
    const mockProvider = createMockProvider("Auth refresh token support");
    
    const messages: Message[] = [
      { id: "1", role: "user", content: "Can you add refresh token support?", createdAt: Date.now() },
      { id: "2", role: "assistant", content: "Sure, I'll help with that.", createdAt: Date.now() },
      { id: "3", role: "user", content: "It should be in the auth module", createdAt: Date.now() },
    ];

    const title = await generateTitle(messages, {
      provider: mockProvider,
      model: "test-model",
    });

    expect(title).toBe("Auth refresh token support");
  });

  it("should return default title when no user messages", async () => {
    const mockProvider = createMockProvider("Some title");
    
    const messages: Message[] = [];

    const title = await generateTitle(messages, {
      provider: mockProvider,
      model: "test-model",
    });

    expect(title).toBe("New conversation");
    expect(mockProvider.stream).not.toHaveBeenCalled();
  });

  it("should handle provider errors gracefully", async () => {
    const mockProvider: LLMProvider = {
      stream: vi.fn().mockRejectedValue(new Error("API error")),
    };
    
    const messages: Message[] = [
      { id: "1", role: "user", content: "Test message", createdAt: Date.now() },
    ];

    const title = await generateTitle(messages, {
      provider: mockProvider,
      model: "test-model",
    });

    expect(title).toBe("New conversation");
  });

  it("should truncate titles longer than 50 characters", async () => {
    const longTitle = "This is a very long title that exceeds the maximum allowed length";
    const mockProvider = createMockProvider(longTitle);
    
    const messages: Message[] = [
      { id: "1", role: "user", content: "Something that generates a long title", createdAt: Date.now() },
    ];

    const title = await generateTitle(messages, {
      provider: mockProvider,
      model: "test-model",
    });

    expect(title.length).toBeLessThanOrEqual(50);
    expect(title).toMatch(/\.\.\.$/);
  });

  it("should remove quotes from title", async () => {
    const mockProvider = createMockProvider('"Debug errors"');
    
    const messages: Message[] = [
      { id: "1", role: "user", content: "Debug errors", createdAt: Date.now() },
    ];

    const title = await generateTitle(messages, {
      provider: mockProvider,
      model: "test-model",
    });

    expect(title).toBe("Debug errors");
  });

  it("should remove Title: prefix", async () => {
    const mockProvider = createMockProvider("Title: Debug errors");
    
    const messages: Message[] = [
      { id: "1", role: "user", content: "Debug errors", createdAt: Date.now() },
    ];

    const title = await generateTitle(messages, {
      provider: mockProvider,
      model: "test-model",
    });

    expect(title).toBe("Debug errors");
  });

  it("should use custom temperature", async () => {
    const mockProvider = createMockProvider("Test title");
    
    const messages: Message[] = [
      { id: "1", role: "user", content: "Test", createdAt: Date.now() },
    ];

    await generateTitle(messages, {
      provider: mockProvider,
      model: "test-model",
      temperature: 0.8,
    });

    expect(mockProvider.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.8,
      })
    );
  });
});

describe("isDefaultTitle", () => {
  it("should return true for null/undefined titles", () => {
    expect(isDefaultTitle(null)).toBe(true);
    expect(isDefaultTitle(undefined)).toBe(true);
  });

  it("should return true for empty string", () => {
    expect(isDefaultTitle("")).toBe(true);
  });

  it("should return true for default title values", () => {
    expect(isDefaultTitle("New conversation")).toBe(true);
    expect(isDefaultTitle("new conversation")).toBe(true);
    expect(isDefaultTitle("Untitled")).toBe(true);
    expect(isDefaultTitle("(untitled)")).toBe(true);
    expect(isDefaultTitle("New session")).toBe(true);
  });

  it("should return false for custom titles", () => {
    expect(isDefaultTitle("Debug production errors")).toBe(false);
    expect(isDefaultTitle("Auth refresh token support")).toBe(false);
    expect(isDefaultTitle("Custom title")).toBe(false);
  });

  it("should handle whitespace", () => {
    expect(isDefaultTitle("  New conversation  ")).toBe(true);
    expect(isDefaultTitle("  Custom title  ")).toBe(false);
  });
});
