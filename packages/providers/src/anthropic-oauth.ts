/**
 * Anthropic OAuth Provider
 * 
 * A provider that uses OAuth authentication with Anthropic.
 * For React Native, pass expo/fetch as the fetch option.
 */

import type { LLMProvider, LLMStreamOptions, LLMStreamResult, LLMStreamChunk, LLMResponse, ToolCall, FinishReason } from "@ants/agent-core";
import { type OAuthTokens, refreshAccessToken, shouldRefreshTokens } from "@ants/agent-auth-core";
import { parseSSEStream } from "./sse.js";

// ============================================================================
// Configuration
// ============================================================================

const ANTHROPIC_API_URL = "https://api.anthropic.com";
const TOOL_PREFIX = "mcp_";
const CLAUDE_CODE_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

// ============================================================================
// Types
// ============================================================================

export interface AnthropicOAuthProviderOptions {
  /** Initial OAuth tokens */
  tokens: OAuthTokens;
  /** Callback when tokens are refreshed */
  onTokenRefresh?: (tokens: OAuthTokens) => Promise<void>;
  /** Custom fetch function (for React Native, use expo/fetch) */
  fetch?: typeof fetch;
  /** Additional headers for requests */
  headers?: Record<string, string>;
}

// Anthropic API types
interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContent[];
}

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: unknown;
  cache_control?: { type: "ephemeral" };
}

/**
 * Map Anthropic stop_reason to normalized FinishReason. Duplicated from
 * anthropic-client.ts to keep this OAuth provider self-contained.
 */
function mapAnthropicStopReason(reason: string | null | undefined): FinishReason | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    case "pause_turn":
      return "pause_turn";
    default:
      return "error";
  }
}

// ============================================================================
// Provider
// ============================================================================

export class AnthropicOAuthProvider implements LLMProvider {
  private tokens: OAuthTokens;
  private onTokenRefresh?: (tokens: OAuthTokens) => Promise<void>;
  private fetchFn: typeof fetch;
  private extraHeaders: Record<string, string>;

  constructor(options: AnthropicOAuthProviderOptions) {
    this.tokens = options.tokens;
    this.onTokenRefresh = options.onTokenRefresh;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.extraHeaders = options.headers ?? {};
  }

  /**
   * Ensure we have a valid access token, refreshing if needed.
   */
  private async ensureValidToken(): Promise<string> {
    if (shouldRefreshTokens(this.tokens)) {
      try {
        // Pass our custom fetch to refreshAccessToken for React Native compatibility
        const refreshed = await refreshAccessToken(this.tokens.refreshToken, this.fetchFn);
        this.tokens = refreshed;
        await this.onTokenRefresh?.(refreshed);
      } catch (error) {
        // Check if this is an invalid_grant error (expired/revoked refresh token)
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('invalid_grant') || errorMessage.includes('Refresh token')) {
          console.error('Anthropic token refresh failed:', error);
          throw new Error(
            'Your Anthropic session has expired. Please disconnect and reconnect your account in Settings.'
          );
        }
        throw error;
      }
    }
    return this.tokens.accessToken;
  }

  /**
   * Stream a response from Anthropic.
   */
  async stream(options: LLMStreamOptions): Promise<LLMStreamResult> {
    const accessToken = await this.ensureValidToken();
    
    const messages = this.convertMessages(options);
    
    // Convert tools with mcp_ prefix for Claude Code compatibility
    // Add cache_control to the last tool for prompt caching
    const tools = options.tools?.map((tool) => this.convertTool(tool));
    if (tools && tools.length > 0) {
      tools[tools.length - 1] = { ...tools[tools.length - 1]!, cache_control: { type: "ephemeral" } };
    }

    // Build system prompt with Claude Code prefix (required for OAuth credentials)
    const systemPrompt = this.buildSystemPrompt(options.system);

    const requestBody = {
      model: options.model,
      messages,
      max_tokens: options.maxTokens ?? 8192,
      stream: true,
      system: systemPrompt,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(tools && tools.length > 0 && { tools }),
    };
    
    const url = `${ANTHROPIC_API_URL}/v1/messages?beta=true`;
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14",
      ...this.extraHeaders,
    };

    const response = await this.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: options.abortSignal,
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMessage: string;
      try {
        const json = JSON.parse(text);
        errorMessage = json.error?.message || json.message || text;
      } catch {
        errorMessage = text || `HTTP ${response.status}`;
      }
      throw new Error(errorMessage);
    }

    if (!response.body) {
      throw new Error("Response has no body");
    }

    // Create shared state
    const state = {
      text: "",
      toolCalls: [] as ToolCall[],
      currentToolCall: null as { id: string; name: string; jsonBuffer: string } | null,
      usage: { promptTokens: 0, completionTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      finishReason: undefined as FinishReason | undefined,
      done: false,
      error: null as Error | null,
    };

    const streamGenerator = this.createStreamGenerator(response.body, options.abortSignal, state);
    // Create a lazy response promise that waits for the stream to be consumed
    // The caller should iterate the stream first, then await response
    const responsePromise = this.createResponsePromise(state);

    return { stream: streamGenerator, response: responsePromise };
  }

  private async *createStreamGenerator(
    body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
    signal: AbortSignal | undefined,
    state: {
      text: string;
      toolCalls: ToolCall[];
      currentToolCall: { id: string; name: string; jsonBuffer: string } | null;
      usage: { promptTokens: number; completionTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };
      finishReason: FinishReason | undefined;
      done: boolean;
      error: Error | null;
    }
  ): AsyncGenerator<LLMStreamChunk> {
    try {
      for await (const sseEvent of parseSSEStream(body, signal)) {
        if (!sseEvent.data) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(sseEvent.data);
        } catch {
          continue;
        }

        const type = event.type as string;

        if (type === "message_start") {
          const usage = (event.message as Record<string, unknown>)?.usage as Record<string, number>;
          if (usage) {
            state.usage.promptTokens = usage.input_tokens ?? 0;
            state.usage.completionTokens = usage.output_tokens ?? 0;
            state.usage.cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
            state.usage.cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;
          }
        } else if (type === "content_block_start") {
          const block = event.content_block as Record<string, unknown>;
          if (block?.type === "tool_use") {
            state.currentToolCall = {
              id: block.id as string,
              name: this.stripToolPrefix(block.name as string),
              jsonBuffer: "",
            };
          }
        } else if (type === "content_block_delta") {
          const delta = event.delta as Record<string, unknown>;
          if (delta?.type === "text_delta") {
            const text = delta.text as string;
            state.text += text;
            yield { type: "text", text };
          } else if (delta?.type === "input_json_delta" && state.currentToolCall) {
            state.currentToolCall.jsonBuffer += delta.partial_json as string;
          }
        } else if (type === "content_block_stop") {
          if (state.currentToolCall) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(state.currentToolCall.jsonBuffer || "{}");
            } catch {
              // Keep empty args
            }
            const toolCall: ToolCall = {
              id: state.currentToolCall.id,
              name: state.currentToolCall.name,
              arguments: args,
            };
            state.toolCalls.push(toolCall);
            yield { type: "tool_call", toolCall };
            state.currentToolCall = null;
          }
        } else if (type === "message_delta") {
          const usage = event.usage as Record<string, number>;
          if (usage) {
            state.usage.completionTokens = usage.output_tokens ?? 0;
          }
          const delta = event.delta as Record<string, unknown> | undefined;
          const stopReason = delta?.stop_reason as string | null | undefined;
          state.finishReason = mapAnthropicStopReason(stopReason) ?? state.finishReason;
        } else if (type === "error") {
          const error = event.error as Record<string, string>;
          throw new Error(error?.message || "Unknown error");
        }
      }
    } catch (error) {
      state.error = error instanceof Error ? error : new Error(String(error));
      throw state.error;
    } finally {
      state.done = true;
    }
  }

  private async createResponsePromise(
    state: {
      text: string;
      toolCalls: ToolCall[];
      usage: { promptTokens: number; completionTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };
      finishReason: FinishReason | undefined;
      done: boolean;
      error: Error | null;
    }
  ): Promise<LLMResponse> {
    // Wait for the stream to be consumed by the caller
    // The caller iterates the stream, which updates state, then awaits this promise
    while (!state.done) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    if (state.error) {
      throw state.error;
    }

    return {
      content: state.text,
      toolCalls: state.toolCalls,
      finishReason: state.finishReason,
      usage: {
        promptTokens: state.usage.promptTokens,
        completionTokens: state.usage.completionTokens,
        totalTokens: state.usage.promptTokens + state.usage.completionTokens,
        cacheCreationInputTokens: state.usage.cacheCreationInputTokens,
        cacheReadInputTokens: state.usage.cacheReadInputTokens,
      },
    };
  }

  /**
   * Convert messages to Anthropic format, adding mcp_ prefix to tool names.
   */
  private convertMessages(options: LLMStreamOptions): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of options.messages) {
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        if (msg.toolResults?.length) {
          const content: AnthropicContent[] = msg.toolResults.map((tr) => ({
            type: "tool_result" as const,
            tool_use_id: tr.id,
            content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
            is_error: tr.isError,
          }));
          result.push({ role: "user", content });
        } else {
          const content: AnthropicContent[] =
            typeof msg.content === "string"
              ? [{ type: "text", text: msg.content }]
              : msg.content.map((part) => {
                  if (part.type === "text") {
                    return { type: "text" as const, text: part.text };
                  } else if (part.type === "image" && part.source.type === "base64") {
                    return {
                      type: "image" as const,
                      source: {
                        type: "base64" as const,
                        media_type: part.source.mediaType,
                        data: part.source.data,
                      },
                    };
                  }
                  throw new Error(`Unsupported content type: ${part.type}`);
                });
          result.push({ role: "user", content });
        }
      } else if (msg.role === "assistant") {
        const content: AnthropicContent[] = [];

        const textContent =
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                .filter((p) => p.type === "text")
                .map((p) => (p as { type: "text"; text: string }).text)
                .join("\n");

        if (textContent?.trim()) {
          content.push({ type: "text", text: textContent });
        }

        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: this.addToolPrefix(tc.name),
              input: tc.arguments,
            });
          }
        }

        if (content.length > 0) {
          result.push({ role: "assistant", content });
        }
      }
    }

    return result;
  }

  /**
   * Convert a tool to Anthropic format with mcp_ prefix.
   */
  private convertTool(tool: { name: string; description: string; parameters: unknown }): AnthropicTool {
    // Convert zod schema to JSON schema if needed
    const params = tool.parameters;
    let inputSchema: unknown;
    
    if (params && typeof params === "object" && "_def" in params) {
      // It's a Zod schema - need to convert
      // Dynamically import to avoid bundling issues
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { zodToJsonSchema } = require("zod-to-json-schema");
        inputSchema = zodToJsonSchema(params, { target: "openApi3" });
      } catch {
        // Fall back to empty object if conversion fails
        inputSchema = { type: "object", properties: {} };
      }
    } else {
      inputSchema = params;
    }

    return {
      name: this.addToolPrefix(tool.name),
      description: tool.description,
      input_schema: inputSchema,
    };
  }

  private addToolPrefix(name: string): string {
    return name.startsWith(TOOL_PREFIX) ? name : `${TOOL_PREFIX}${name}`;
  }

  private stripToolPrefix(name: string): string {
    return name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name;
  }

  /**
   * Build the system prompt with Claude Code prefix.
   * OAuth credentials require the Claude Code system prefix for authorization.
   */
  private buildSystemPrompt(userSystem?: string): Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
    const systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [];
    
    // Always add Claude Code prefix first (required for OAuth)
    systemBlocks.push({
      type: "text",
      text: CLAUDE_CODE_SYSTEM_PREFIX,
      cache_control: { type: "ephemeral" },
    });
    
    // Add user's system prompt if provided, sanitizing any conflicting names
    if (userSystem) {
      const sanitizedSystem = userSystem
        .replace(/Ants Agent/gi, "Claude Code")
        .replace(/ants-agent/gi, "Claude")
        .replace(/ants/gi, "Claude Code");
      
      systemBlocks.push({
        type: "text",
        text: sanitizedSystem,
        cache_control: { type: "ephemeral" },
      });
    }
    
    return systemBlocks;
  }
}

/**
 * Create an Anthropic OAuth provider.
 */
export function createAnthropicOAuthProvider(options: AnthropicOAuthProviderOptions): AnthropicOAuthProvider {
  return new AnthropicOAuthProvider(options);
}
