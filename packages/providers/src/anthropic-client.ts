/**
 * Direct Anthropic API client with SSE streaming support.
 * 
 * This replaces the Vercel AI SDK with direct API calls that work
 * cross-platform (Node.js, Electron, React Native).
 */

import { readSSEResponse } from "./sse.js";
import type {
  LLMMessage,
  LLMTool,
  LLMStreamChunk,
  LLMResponse,
  ToolCall,
  ContentPart,
} from "@ants/agent-core";
import { zodToJsonSchema } from "zod-to-json-schema";

// ============================================================================
// Types
// ============================================================================

export interface AnthropicClientOptions {
  /** Custom fetch function (for React Native, use expo/fetch) */
  fetch?: typeof fetch;
  /** Base URL for the API */
  baseUrl?: string;
  /** Default headers to include in all requests */
  defaultHeaders?: Record<string, string>;
}

export interface AnthropicStreamOptions {
  model: string;
  messages: LLMMessage[];
  tools?: LLMTool[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface AnthropicAuth {
  type: "api-key" | "oauth";
  apiKey?: string;
  accessToken?: string;
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

type AnthropicSystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicSystemBlock[];
  max_tokens: number;
  temperature?: number;
  tools?: AnthropicTool[];
  stream: boolean;
}

// SSE event types from Anthropic
interface MessageStartEvent {
  type: "message_start";
  message: {
    id: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface ContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: string };
}

interface ContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string };
}

interface ContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

interface MessageDeltaEvent {
  type: "message_delta";
  delta: { stop_reason: string };
  usage: { output_tokens: number };
}

interface MessageStopEvent {
  type: "message_stop";
}

interface ErrorEvent {
  type: "error";
  error: { type: string; message: string };
}

type AnthropicSSEEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | ErrorEvent;

// ============================================================================
// Message Conversion
// ============================================================================

function convertContentPart(part: ContentPart): AnthropicContent {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  } else if (part.type === "image") {
    if (part.source.type === "base64") {
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: part.source.mediaType,
          data: part.source.data,
        },
      };
    } else {
      // URL images - Anthropic doesn't support URL directly, would need to fetch
      throw new Error("URL images not supported - use base64 encoding");
    }
  }
  throw new Error(`Unknown content part type: ${JSON.stringify(part)}`);
}

function convertMessages(messages: LLMMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // System messages are handled separately in Anthropic
      continue;
    }

    if (msg.role === "user") {
      if (msg.toolResults?.length) {
        // Tool results
        const content: AnthropicContent[] = msg.toolResults.map((tr) => ({
          type: "tool_result" as const,
          tool_use_id: tr.id,
          content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
          is_error: tr.isError,
        }));
        result.push({ role: "user", content });
      } else {
        // Regular user message
        const content: AnthropicContent[] =
          typeof msg.content === "string"
            ? [{ type: "text", text: msg.content }]
            : msg.content.map(convertContentPart);
        result.push({ role: "user", content });
      }
    } else if (msg.role === "assistant") {
      const content: AnthropicContent[] = [];

      // Add text content
      const textContent =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("\n");

      if (textContent && textContent.trim()) {
        content.push({ type: "text", text: textContent });
      }

      // Add tool calls
      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
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

function convertTools(tools: LLMTool[]): AnthropicTool[] {
  return tools.map((tool) => {
    // Anthropic requires JSON Schema (draft 2020-12). OpenAPI 3's `nullable: true`
    // and other dialect quirks make Anthropic reject the request, so use the
    // default JSON Schema output and drop the `$schema` meta-field which
    // Anthropic doesn't want on a tool input_schema.
    const schema = zodToJsonSchema(tool.parameters) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema,
    };
  });
}

// ============================================================================
// Anthropic Client
// ============================================================================

export class AnthropicClient {
  private fetchFn: typeof fetch;
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(options: AnthropicClientOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  /**
   * Stream a chat completion from the Anthropic API.
   * Returns an async generator of chunks and a promise for the final response.
   */
  async stream(
    auth: AnthropicAuth,
    options: AnthropicStreamOptions
  ): Promise<{ stream: AsyncIterable<LLMStreamChunk>; response: Promise<LLMResponse> }> {
    const messages = convertMessages(options.messages);
    const tools = options.tools ? convertTools(options.tools) : undefined;

    // Build system prompt as blocks with cache_control for prompt caching
    const systemBlocks: AnthropicSystemBlock[] | undefined = options.system
      ? [{ type: "text", text: options.system, cache_control: { type: "ephemeral" } }]
      : undefined;

    // Add cache_control to the last tool definition for prompt caching
    const cachedTools = tools ? this.addToolCacheControl(tools) : undefined;

    const requestBody: AnthropicRequest = {
      model: options.model,
      messages,
      max_tokens: options.maxTokens ?? 8192,
      stream: true,
      ...(systemBlocks && { system: systemBlocks }),
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(cachedTools && cachedTools.length > 0 && { tools: cachedTools }),
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...this.defaultHeaders,
    };

    if (auth.type === "api-key" && auth.apiKey) {
      headers["x-api-key"] = auth.apiKey;
    } else if (auth.type === "oauth" && auth.accessToken) {
      headers["Authorization"] = `Bearer ${auth.accessToken}`;
    } else {
      throw new Error("No valid authentication provided");
    }

    const response = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: options.abortSignal,
    });

    // Create shared state for stream and response
    const state = {
      text: "",
      toolCalls: [] as ToolCall[],
      currentToolCall: null as { id: string; name: string; jsonBuffer: string } | null,
      usage: { promptTokens: 0, completionTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      done: false,
      error: null as Error | null,
    };

    // Create the stream generator
    const streamGenerator = this.createStreamGenerator(response, options.abortSignal, state);

    // Create the response promise
    const responsePromise = this.createResponsePromise(streamGenerator, state);

    return {
      stream: streamGenerator,
      response: responsePromise,
    };
  }

  /**
   * Add cache_control to the last tool definition to enable prompt caching
   * for the tool list. Anthropic caches everything up to and including the
   * last block with cache_control.
   */
  private addToolCacheControl(tools: AnthropicTool[]): AnthropicTool[] {
    if (tools.length === 0) return tools;
    const result = [...tools];
    result[result.length - 1] = {
      ...result[result.length - 1]!,
      cache_control: { type: "ephemeral" },
    };
    return result;
  }

  private async *createStreamGenerator(
    response: Response,
    signal: AbortSignal | undefined,
    state: {
      text: string;
      toolCalls: ToolCall[];
      currentToolCall: { id: string; name: string; jsonBuffer: string } | null;
      usage: { promptTokens: number; completionTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };
      done: boolean;
      error: Error | null;
    }
  ): AsyncGenerator<LLMStreamChunk> {
    try {
      for await (const sseEvent of readSSEResponse(response, signal)) {
        if (!sseEvent.data) continue;

        let event: AnthropicSSEEvent;
        try {
          event = JSON.parse(sseEvent.data);
        } catch {
          continue; // Skip malformed JSON
        }

        switch (event.type) {
          case "message_start":
            state.usage.promptTokens = event.message.usage.input_tokens;
            state.usage.completionTokens = event.message.usage.output_tokens;
            state.usage.cacheCreationInputTokens = event.message.usage.cache_creation_input_tokens ?? 0;
            state.usage.cacheReadInputTokens = event.message.usage.cache_read_input_tokens ?? 0;
            break;

          case "content_block_start":
            if (event.content_block.type === "tool_use") {
              state.currentToolCall = {
                id: event.content_block.id,
                name: event.content_block.name,
                jsonBuffer: "",
              };
            }
            break;

          case "content_block_delta":
            if (event.delta.type === "text_delta") {
              state.text += event.delta.text;
              yield { type: "text", text: event.delta.text };
            } else if (event.delta.type === "input_json_delta" && state.currentToolCall) {
              state.currentToolCall.jsonBuffer += event.delta.partial_json;
            }
            break;

          case "content_block_stop":
            if (state.currentToolCall) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(state.currentToolCall.jsonBuffer || "{}");
              } catch {
                // Keep empty args if JSON parsing fails
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
            break;

          case "message_delta":
            state.usage.completionTokens = event.usage.output_tokens;
            break;

          case "message_stop":
            state.done = true;
            break;

          case "error":
            throw new Error(event.error.message);
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
    stream: AsyncGenerator<LLMStreamChunk>,
    state: {
      text: string;
      toolCalls: ToolCall[];
      usage: { promptTokens: number; completionTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };
      done: boolean;
      error: Error | null;
    }
  ): Promise<LLMResponse> {
    // Consume the stream to populate state
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of stream) {
      // State is updated by the generator
    }

    if (state.error) {
      throw state.error;
    }

    return {
      content: state.text,
      toolCalls: state.toolCalls,
      usage: {
        promptTokens: state.usage.promptTokens,
        completionTokens: state.usage.completionTokens,
        totalTokens: state.usage.promptTokens + state.usage.completionTokens,
        cacheCreationInputTokens: state.usage.cacheCreationInputTokens,
        cacheReadInputTokens: state.usage.cacheReadInputTokens,
      },
    };
  }
}

/**
 * Create a default Anthropic client.
 */
export function createAnthropicClient(options?: AnthropicClientOptions): AnthropicClient {
  return new AnthropicClient(options);
}
