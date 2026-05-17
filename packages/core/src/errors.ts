/**
 * Typed errors raised by the agent loop and provider layer.
 */

import type { FinishReason } from "./types.js";

/**
 * Thrown when a model completion ends with a non-terminal finish reason
 * (e.g. `max_tokens`, `content_filter`, `refusal`) AND the response contains
 * no tool calls — i.e. there is no useful work to continue with. Callers
 * that catch this can surface it to the user or retry with adjusted
 * parameters (larger maxTokens, different prompt, etc.). Auto-retrying
 * the same request is generally not safe because the same input will
 * truncate or be filtered the same way.
 */
export class IncompleteResponseError extends Error {
  override readonly name = "IncompleteResponseError";
  readonly finishReason: FinishReason;
  /** Partial content the model produced before stopping (may be empty). */
  readonly content: string;

  constructor(finishReason: FinishReason, content: string, message?: string) {
    super(message ?? defaultMessage(finishReason));
    this.finishReason = finishReason;
    this.content = content;
  }
}

function defaultMessage(reason: FinishReason): string {
  switch (reason) {
    case "max_tokens":
      return "Model response was truncated: output token limit reached. Increase maxTokens or shorten the prompt.";
    case "content_filter":
      return "Model response was blocked by the provider's content filter.";
    case "refusal":
      return "Model refused to respond.";
    case "pause_turn":
      return "Model turn was paused by the provider and needs to be resumed.";
    case "error":
      return "Model finished with an error status.";
    case "stop":
    case "tool_calls":
      // These are terminal; callers should not be constructing this error
      // for them, but if they do, give a sensible message.
      return `Unexpected incomplete-response for terminal finish reason: ${reason}`;
  }
}
