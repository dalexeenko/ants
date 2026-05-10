import type { Message, LLMMessage, LLMTool, ContentPart } from "../types.js";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for LLM message content which can be either a string
 * or an array of content parts (text + images).
 */
function estimateContentTokens(content: string | ContentPart[]): number {
  if (typeof content === "string") {
    return estimateTokens(content);
  }
  let tokens = 0;
  for (const part of content) {
    if (part.type === "text") {
      tokens += estimateTokens(part.text);
    } else if (part.type === "image") {
      // Images use a fixed token budget in most APIs (~1600 tokens for typical images)
      tokens += 1600;
    }
  }
  return tokens;
}

/**
 * Serialize a tool result to a string for token estimation.
 * Handles non-string results by JSON-stringifying them instead of
 * using String() which would produce "[object Object]".
 */
function serializeResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

export function estimateMessageTokens(message: Message): number {
  // ~4 tokens per message for role/structure overhead
  let tokens = 4 + estimateTokens(message.content);

  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      tokens += estimateTokens(tc.name);
      tokens += estimateTokens(JSON.stringify(tc.arguments));
    }
  }

  if (message.toolResults) {
    for (const tr of message.toolResults) {
      tokens += estimateTokens(tr.name ?? "");
      tokens += estimateTokens(serializeResult(tr.result));
    }
  }

  return tokens;
}

export function estimateConversationTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

/**
 * Estimate the LLM message array token count (used for pre-send validation).
 * This operates on LLMMessage[] which is the format actually sent to the provider.
 */
export function estimateLLMMessageTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    // ~4 tokens per message for role/structure
    total += 4;
    total += estimateContentTokens(msg.content);

    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        total += estimateTokens(tc.name);
        total += estimateTokens(JSON.stringify(tc.arguments));
      }
    }

    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        total += estimateTokens(tr.name ?? "");
        total += estimateTokens(serializeResult(tr.result));
      }
    }
  }
  return total;
}

/**
 * Estimate token count for tool definitions (schemas sent to the API).
 * Each tool has a name, description, and parameter schema.
 */
export function estimateToolDefinitionTokens(tools: LLMTool[]): number {
  let total = 0;
  for (const tool of tools) {
    total += estimateTokens(tool.name);
    total += estimateTokens(tool.description);
    // The parameters are a Zod schema; when sent to the API they become
    // a JSON Schema object. We approximate by stringifying the schema.
    try {
      // Zod schemas have a .shape or can be described — but the simplest
      // approximation is just the description length + a base overhead
      // for a typical tool schema (~50 tokens per tool for the JSON structure).
      total += 50;
    } catch {
      total += 50;
    }
  }
  return total;
}

/**
 * Estimate the total token count for a full LLM API payload:
 * system prompt + messages + tool definitions + structural overhead.
 */
export function estimatePayloadTokens(
  systemPrompt: string,
  messages: LLMMessage[],
  tools: LLMTool[]
): number {
  let total = 0;

  // System prompt
  total += estimateTokens(systemPrompt);

  // Messages
  total += estimateLLMMessageTokens(messages);

  // Tool definitions
  total += estimateToolDefinitionTokens(tools);

  // Base overhead for API framing (headers, structure, etc.)
  total += 100;

  return total;
}
