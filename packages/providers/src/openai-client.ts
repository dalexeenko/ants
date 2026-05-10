/**
 * Direct OpenAI-compatible API client with SSE streaming support.
 * 
 * This works with OpenAI, Groq, OpenRouter, XAI, and other OpenAI-compatible APIs.
 */

import { readSSEResponse } from "./sse.js";
import type {
  LLMMessage,
  LLMTool,
  LLMStreamChunk,
  LLMResponse,
  ToolCall,
  ContentPart,
} from "@openmgr/agent-core";
import { zodToJsonSchema } from "zod-to-json-schema";

// ============================================================================
// Types
// ============================================================================

export interface OpenAIClientOptions {
  /** Custom fetch function (for React Native, use expo/fetch) */
  fetch?: typeof fetch;
  /** Base URL for the API */
  baseUrl?: string;
  /** Default headers to include in all requests */
  defaultHeaders?: Record<string, string>;
}

export interface OpenAIStreamOptions {
  model: string;
  messages: LLMMessage[];
  tools?: LLMTool[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface OpenAIAuth {
  apiKey: string;
}

// OpenAI API types
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAIContentPart[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: OpenAITool[];
  stream: boolean;
  stream_options?: { include_usage: boolean };
}

// SSE event types from OpenAI
interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

// ============================================================================
// Message Conversion
// ============================================================================

function convertContentPart(part: ContentPart): OpenAIContentPart {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  } else if (part.type === "image") {
    if (part.source.type === "base64") {
      return {
        type: "image_url",
        image_url: { url: `data:${part.source.mediaType};base64,${part.source.data}` },
      };
    } else {
      return {
        type: "image_url",
        image_url: { url: part.source.url },
      };
    }
  }
  throw new Error(`Unknown content part type: ${JSON.stringify(part)}`);
}

function extractText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

function convertMessages(messages: LLMMessage[], system?: string): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  // Add system message first
  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: extractText(msg.content) });
    } else if (msg.role === "user") {
      if (msg.toolResults?.length) {
        // Tool results - each goes as a separate message
        for (const tr of msg.toolResults) {
          result.push({
            role: "tool",
            tool_call_id: tr.id,
            content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
          });
        }
      } else {
        // Regular user message
        if (typeof msg.content === "string") {
          result.push({ role: "user", content: msg.content });
        } else {
          result.push({ role: "user", content: msg.content.map(convertContentPart) });
        }
      }
    } else if (msg.role === "assistant") {
      const content = extractText(msg.content);
      const toolCalls = msg.toolCalls?.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));

      result.push({
        role: "assistant",
        content: content || undefined,
        tool_calls: toolCalls?.length ? toolCalls : undefined,
      });
    }
  }

  return result;
}

function convertTools(tools: LLMTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters, { target: "openApi3" }),
    },
  }));
}

// ============================================================================
// OpenAI Client
// ============================================================================

export class OpenAIClient {
  private fetchFn: typeof fetch;
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(options: OpenAIClientOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  /**
   * Stream a chat completion from the OpenAI-compatible API.
   */
  async stream(
    auth: OpenAIAuth,
    options: OpenAIStreamOptions
  ): Promise<{ stream: AsyncIterable<LLMStreamChunk>; response: Promise<LLMResponse> }> {
    const messages = convertMessages(options.messages, options.system);
    const tools = options.tools ? convertTools(options.tools) : undefined;

    const requestBody: OpenAIRequest = {
      model: options.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(options.maxTokens && { max_tokens: options.maxTokens }),
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(tools && tools.length > 0 && { tools }),
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${auth.apiKey}`,
      ...this.defaultHeaders,
    };

    const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: options.abortSignal,
    });

    // Create shared state for stream and response
    const state = {
      text: "",
      toolCalls: new Map<number, { id: string; name: string; argumentsBuffer: string }>(),
      usage: { promptTokens: 0, completionTokens: 0, cacheReadInputTokens: 0 },
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

  private async *createStreamGenerator(
    response: Response,
    signal: AbortSignal | undefined,
    state: {
      text: string;
      toolCalls: Map<number, { id: string; name: string; argumentsBuffer: string }>;
      usage: { promptTokens: number; completionTokens: number; cacheReadInputTokens: number };
      done: boolean;
      error: Error | null;
    }
  ): AsyncGenerator<LLMStreamChunk> {
    try {
      for await (const sseEvent of readSSEResponse(response, signal)) {
        if (!sseEvent.data || sseEvent.data === "[DONE]") {
          state.done = true;
          continue;
        }

        let chunk: ChatCompletionChunk;
        try {
          chunk = JSON.parse(sseEvent.data);
        } catch {
          continue; // Skip malformed JSON
        }

        // Handle usage
        if (chunk.usage) {
          state.usage.promptTokens = chunk.usage.prompt_tokens;
          state.usage.completionTokens = chunk.usage.completion_tokens;
          state.usage.cacheReadInputTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
        }

        // Process choices
        for (const choice of chunk.choices) {
          const delta = choice.delta;

          // Text content
          if (delta.content) {
            state.text += delta.content;
            yield { type: "text", text: delta.content };
          }

          // Tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              let toolCall = state.toolCalls.get(tc.index);
              
              if (!toolCall) {
                toolCall = {
                  id: tc.id || "",
                  name: tc.function?.name || "",
                  argumentsBuffer: "",
                };
                state.toolCalls.set(tc.index, toolCall);
              }

              if (tc.id) toolCall.id = tc.id;
              if (tc.function?.name) toolCall.name = tc.function.name;
              if (tc.function?.arguments) {
                toolCall.argumentsBuffer += tc.function.arguments;
              }
            }
          }

          // If finish_reason is set, emit completed tool calls
          if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
            for (const [, tc] of state.toolCalls) {
              if (tc.id && tc.name) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.argumentsBuffer || "{}");
                } catch {
                  // Keep empty args if JSON parsing fails
                }
                yield {
                  type: "tool_call",
                  toolCall: {
                    id: tc.id,
                    name: tc.name,
                    arguments: args,
                  },
                };
              }
            }
            state.toolCalls.clear();
          }
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
      toolCalls: Map<number, { id: string; name: string; argumentsBuffer: string }>;
      usage: { promptTokens: number; completionTokens: number; cacheReadInputTokens: number };
      done: boolean;
      error: Error | null;
    }
  ): Promise<LLMResponse> {
    const toolCalls: ToolCall[] = [];

    // Consume the stream to populate state
    for await (const chunk of stream) {
      if (chunk.type === "tool_call" && chunk.toolCall) {
        toolCalls.push(chunk.toolCall);
      }
    }

    if (state.error) {
      throw state.error;
    }

    return {
      content: state.text,
      toolCalls,
      usage: {
        promptTokens: state.usage.promptTokens,
        completionTokens: state.usage.completionTokens,
        totalTokens: state.usage.promptTokens + state.usage.completionTokens,
        // OpenAI has no cache write concept (automatic caching), only read
        cacheReadInputTokens: state.usage.cacheReadInputTokens,
      },
    };
  }
}

/**
 * Create a default OpenAI client.
 */
export function createOpenAIClient(options?: OpenAIClientOptions): OpenAIClient {
  return new OpenAIClient(options);
}
