/**
 * Direct Google Generative AI (Gemini) client with SSE streaming support.
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

export interface GoogleClientOptions {
  /** Custom fetch function */
  fetch?: typeof fetch;
  /** Base URL for the API */
  baseUrl?: string;
  /** Default headers */
  defaultHeaders?: Record<string, string>;
}

export interface GoogleStreamOptions {
  model: string;
  messages: LLMMessage[];
  tools?: LLMTool[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface GoogleAuth {
  apiKey: string;
}

// Google API types
interface GoogleContent {
  role: "user" | "model";
  parts: GooglePart[];
}

type GooglePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: { result: unknown } } };

interface GoogleTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
}

interface GoogleRequest {
  contents: GoogleContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
  };
  tools?: GoogleTool[];
}

// SSE response chunk type
interface GoogleStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { name: string; args: unknown };
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

// ============================================================================
// Message Conversion
// ============================================================================

function convertContentPart(part: ContentPart): GooglePart {
  if (part.type === "text") {
    return { text: part.text };
  } else if (part.type === "image") {
    if (part.source.type === "base64") {
      return {
        inlineData: {
          mimeType: part.source.mediaType,
          data: part.source.data,
        },
      };
    } else {
      throw new Error("Google AI only supports base64 images");
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

function convertMessages(messages: LLMMessage[]): GoogleContent[] {
  const result: GoogleContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // System messages are handled separately
      continue;
    }

    if (msg.role === "user") {
      if (msg.toolResults?.length) {
        // Tool results
        const parts: GooglePart[] = msg.toolResults.map((tr) => ({
          functionResponse: {
            name: tr.name,
            response: { result: tr.result },
          },
        }));
        result.push({ role: "user", parts });
      } else {
        // Regular user message
        const parts: GooglePart[] =
          typeof msg.content === "string"
            ? [{ text: msg.content }]
            : msg.content.map(convertContentPart);
        result.push({ role: "user", parts });
      }
    } else if (msg.role === "assistant") {
      const parts: GooglePart[] = [];

      // Add text content
      const textContent = extractText(msg.content);
      if (textContent && textContent.trim()) {
        parts.push({ text: textContent });
      }

      // Add function calls
      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.arguments,
            },
          });
        }
      }

      if (parts.length > 0) {
        result.push({ role: "model", parts });
      }
    }
  }

  return result;
}

function convertTools(tools: LLMTool[]): GoogleTool[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters, { target: "openApi3" }),
      })),
    },
  ];
}

// ============================================================================
// Google Client
// ============================================================================

export class GoogleClient {
  private fetchFn: typeof fetch;
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(options: GoogleClientOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  /**
   * Stream a chat completion from the Google Generative AI API.
   */
  async stream(
    auth: GoogleAuth,
    options: GoogleStreamOptions
  ): Promise<{ stream: AsyncIterable<LLMStreamChunk>; response: Promise<LLMResponse> }> {
    const contents = convertMessages(options.messages);
    const tools = options.tools?.length ? convertTools(options.tools) : undefined;

    const requestBody: GoogleRequest = {
      contents,
      ...(options.system && {
        systemInstruction: { parts: [{ text: options.system }] },
      }),
      generationConfig: {
        ...(options.maxTokens && { maxOutputTokens: options.maxTokens }),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
      },
      ...(tools && { tools }),
    };

    const url = `${this.baseUrl}/models/${options.model}:streamGenerateContent?alt=sse&key=${auth.apiKey}`;

    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.defaultHeaders,
      },
      body: JSON.stringify(requestBody),
      signal: options.abortSignal,
    });

    // Create shared state for stream and response
    const state = {
      text: "",
      toolCalls: [] as ToolCall[],
      usage: { promptTokens: 0, completionTokens: 0, cacheReadInputTokens: 0 },
      done: false,
      error: null as Error | null,
    };

    // Create the stream generator. The caller iterates it (which populates
    // state); the response promise just waits for state.done. A shared
    // generator with two consumers interleaves .next() calls so each chunk
    // goes to only one side, dropping deltas/tool calls for the other.
    const streamGenerator = this.createStreamGenerator(response, options.abortSignal, state);
    const responsePromise = this.createResponsePromise(state);

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
      toolCalls: ToolCall[];
      usage: { promptTokens: number; completionTokens: number; cacheReadInputTokens: number };
      done: boolean;
      error: Error | null;
    }
  ): AsyncGenerator<LLMStreamChunk> {
    try {
      for await (const sseEvent of readSSEResponse(response, signal)) {
        if (!sseEvent.data) continue;

        let chunk: GoogleStreamChunk;
        try {
          chunk = JSON.parse(sseEvent.data);
        } catch {
          continue; // Skip malformed JSON
        }

        // Handle usage
        if (chunk.usageMetadata) {
          state.usage.promptTokens = chunk.usageMetadata.promptTokenCount ?? 0;
          state.usage.completionTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
          state.usage.cacheReadInputTokens = chunk.usageMetadata.cachedContentTokenCount ?? 0;
        }

        // Process candidates
        for (const candidate of chunk.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            if (part.text) {
              state.text += part.text;
              yield { type: "text", text: part.text };
            }

            if (part.functionCall) {
              const toolCall: ToolCall = {
                id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                name: part.functionCall.name,
                arguments: (part.functionCall.args as Record<string, unknown>) ?? {},
              };
              state.toolCalls.push(toolCall);
              yield { type: "tool_call", toolCall };
            }
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
    state: {
      text: string;
      toolCalls: ToolCall[];
      usage: { promptTokens: number; completionTokens: number; cacheReadInputTokens: number };
      done: boolean;
      error: Error | null;
    }
  ): Promise<LLMResponse> {
    // Wait for the caller to drain the stream (which sets state.done in finally).
    while (!state.done) {
      await new Promise((resolve) => setTimeout(resolve, 10));
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
        // Google has no cache write concept, only read
        cacheReadInputTokens: state.usage.cacheReadInputTokens,
      },
    };
  }
}

/**
 * Create a Google Generative AI client.
 */
export function createGoogleClient(options?: GoogleClientOptions): GoogleClient {
  return new GoogleClient(options);
}
