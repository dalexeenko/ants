import { generateId } from "../utils/id.js";
import type { Message, LLMProvider } from "../types.js";
import type { CompactionConfig, CompactionResult, CompactionStats } from "./types.js";
import { DEFAULT_COMPACTION_CONFIG, getModelLimit } from "./types.js";
import { estimateTokens, estimateConversationTokens } from "./tokens.js";

export const COMPACTION_SUMMARY_PREFIX = "[Conversation Summary]";

const SUMMARY_PROMPT = `You are a conversation summarizer. Summarize the following conversation into a structured summary that captures all important context.

The summary should include:
## Tasks Completed
- [Bullet list of completed tasks with outcomes]

## Files Modified
- [List of files with brief description of changes]

## Key Decisions
- [Important decisions made and their rationale]

## Problems Encountered
- [Any errors, blockers, or issues]

## Current State
[Where we are - 1-2 sentences]

## Next Steps
- [Unfinished work or pending items]

IMPORTANT: If there is an existing conversation summary included below, incorporate its information into your new summary. Do not lose any important context from the existing summary.

Be thorough but concise. This summary will be used as context for continuing the conversation.

Conversation to summarize:
`;

export class CompactionEngine {
  private config: CompactionConfig;
  private provider: LLMProvider;
  private model: string;

  constructor(
    provider: LLMProvider,
    model: string,
    config: Partial<CompactionConfig> = {}
  ) {
    this.provider = provider;
    this.model = model;
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  }

  /**
   * Check if compaction is needed based on the working window size.
   * The working window is everything from the last compaction summary to the end.
   */
  shouldCompact(messages: Message[]): CompactionStats | null {
    if (!this.config.enabled) return null;

    const workingWindow = this.getWorkingWindow(messages);
    const modelLimit = getModelLimit(this.model);
    const thresholdTokens = Math.floor(modelLimit * this.config.tokenThreshold);
    const currentTokens = estimateConversationTokens(workingWindow);

    if (currentTokens >= thresholdTokens) {
      return {
        currentTokens,
        threshold: thresholdTokens,
        messagesToCompact: workingWindow.length,
      };
    }

    if (this.config.messageThreshold && workingWindow.length >= this.config.messageThreshold) {
      return {
        currentTokens,
        threshold: thresholdTokens,
        messagesToCompact: workingWindow.length,
      };
    }

    return null;
  }

  /**
   * Get the working window: all messages from the last compaction summary
   * to the end of the conversation. If no compaction has happened yet,
   * returns all messages.
   */
  getWorkingWindow(messages: Message[]): Message[] {
    const lastSummaryIndex = this.findLastSummaryIndex(messages);
    if (lastSummaryIndex === -1) {
      return messages;
    }
    // Include the summary message itself plus everything after it
    return messages.slice(lastSummaryIndex);
  }

  /**
   * Compact the conversation by summarizing the working window.
   * Returns the compaction result with the summary text.
   * The caller is responsible for appending the summary message to the conversation.
   *
   * @param onDelta — optional callback invoked with each streamed text chunk
   *   so callers (e.g. the executor) can emit real-time progress events.
   */
  async compact(
    messages: Message[],
    onDelta?: (delta: string) => void,
  ): Promise<CompactionResult> {
    const workingWindow = this.getWorkingWindow(messages);

    if (workingWindow.length === 0) {
      throw new Error("No messages to compact");
    }

    const originalTokens = estimateConversationTokens(workingWindow);
    const conversationText = this.formatMessagesForSummary(workingWindow);
    const summaryPrompt = SUMMARY_PROMPT + conversationText;

    const summaryModel = this.config.model ?? this.model;
    const { stream, response } = await this.provider.stream({
      model: summaryModel,
      messages: [{ role: "user", content: summaryPrompt }],
      system: "You are a helpful assistant that creates structured summaries.",
    });

    // Stream summary text, emitting deltas for real-time UI updates
    let summary = "";
    for await (const chunk of stream) {
      if (chunk.type === "text" && chunk.text) {
        summary += chunk.text;
        onDelta?.(chunk.text);
      }
    }

    // Await the final response to ensure usage stats are available
    const finalResponse = await response;
    // Prefer the final content if it differs (e.g. provider reconciled)
    if (finalResponse.content && finalResponse.content !== summary) {
      summary = finalResponse.content;
    }

    const compactedTokens = estimateTokens(summary);
    const compressionRatio = originalTokens > 0 ? compactedTokens / originalTokens : 1;
    const compactionId = generateId();

    return {
      compactionId,
      summary,
      originalTokens,
      compactedTokens,
      messagesPruned: workingWindow.length,
      compressionRatio,
    };
  }

  /**
   * Create a compaction summary message.
   */
  createSummaryMessage(summary: string): Message {
    return {
      id: generateId(),
      role: "user",
      content: `${COMPACTION_SUMMARY_PREFIX}\n\n${summary}`,
      createdAt: Date.now(),
    };
  }

  /**
   * Check if a message is a compaction summary message.
   */
  isSummaryMessage(message: Message): boolean {
    return message.content.startsWith(COMPACTION_SUMMARY_PREFIX);
  }

  /**
   * Find the index of the last compaction summary message.
   * Returns -1 if no summary exists.
   */
  private findLastSummaryIndex(messages: Message[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && this.isSummaryMessage(msg)) {
        return i;
      }
    }
    return -1;
  }

  private formatMessagesForSummary(messages: Message[]): string {
    const parts: string[] = [];

    for (const msg of messages) {
      // Skip including summary messages in the formatted text — their content
      // is already present as-is and the LLM prompt tells it to incorporate
      // existing summaries.
      if (this.isSummaryMessage(msg)) {
        parts.push(`Previous Summary:\n${msg.content.replace(`${COMPACTION_SUMMARY_PREFIX}\n\n`, "")}`);
        continue;
      }

      const role = msg.role === "user" ? "User" : "Assistant";

      if (msg.content) {
        parts.push(`${role}: ${msg.content}`);
      }

      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push(`${role} called tool: ${tc.name}`);
        }
      }

      if (msg.toolResults) {
        for (const tr of msg.toolResults) {
          const status = tr.isError ? "failed" : "succeeded";
          const preview = String(tr.result).slice(0, 200);
          parts.push(`Tool ${tr.name} ${status}: ${preview}${String(tr.result).length > 200 ? "..." : ""}`);
        }
      }
    }

    return parts.join("\n\n");
  }

  getConfig(): CompactionConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<CompactionConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
