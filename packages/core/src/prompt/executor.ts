/**
 * PromptExecutor — Manages the agent loop, LLM response generation,
 * and message building. Extracted from the Agent class to keep it focused.
 */

import { generateId } from "../utils/id.js";
import type { ToolRegistry } from "../registry/tools.js";
import { DEFAULT_SYSTEM_PROMPT } from "../types.js";
import type {
  AgentConfig,
  AgentEvent,
  FinishReason,
  Message,
  LLMProvider,
  LLMMessage,
  LLMTool,
  ToolCall,
  ToolResult,
} from "../types.js";
import { IncompleteResponseError } from "../errors.js";
import type { UsageTracker } from "../usage/tracker.js";
import { getModelLimit } from "../compaction/types.js";
import { estimatePayloadTokens } from "../compaction/tokens.js";

/**
 * Callback for executing tool calls. The Agent passes its tool execution
 * logic (which delegates to ToolExecutor) via this callback so that
 * PromptExecutor does not depend on ToolExecutor directly.
 */
export type ExecuteToolsFn = (
  messageId: string,
  toolCalls: ToolCall[]
) => Promise<ToolResult[]>;

/**
 * Callback for running compaction. The Agent passes its compaction logic
 * so PromptExecutor doesn't need direct access to the compaction engine.
 *
 * @param onDelta — optional callback invoked with each streamed summary
 *   text chunk so the executor can emit `compaction.delta` events.
 */
export type RunCompactionFn = (onDelta?: (delta: string) => void) => Promise<{
  compactionId: string;
  originalTokens: number;
  compactedTokens: number;
  messagesPruned: number;
  compressionRatio: number;
}>;

export interface PromptExecutorDeps {
  getProvider: () => LLMProvider | null;
  getConfig: () => AgentConfig;
  getMessages: () => Message[];
  pushMessage: (msg: Message) => void | Promise<void>;
  getAbortSignal: () => AbortSignal | undefined;
  emitEvent: (event: AgentEvent) => void;
  getSessionId: () => string | undefined;
  getUsageTracker: () => UsageTracker;
  getToolRegistry: () => ToolRegistry;
  /** Whether auto-compaction is enabled and a compaction engine exists */
  shouldAutoCompact: () => boolean;
  /** Check if compaction threshold is reached */
  checkCompactionNeeded: () => { currentTokens: number; threshold: number; messagesToCompact: number } | null;
  /** Run compaction */
  runCompaction: RunCompactionFn;
  /** Get the working window of messages (from last compaction summary to end) */
  getWorkingWindow: () => Message[];
  /** Execute tools (delegates to ToolExecutor via Agent) */
  executeTools: ExecuteToolsFn;
}

/**
 * Check whether an error from an LLM provider indicates the prompt
 * exceeded the model's context window.
 */
function isContextLengthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  return (
    // Anthropic
    lower.includes("prompt is too long") ||
    // OpenAI / OpenRouter / Groq / xAI
    lower.includes("context_length_exceeded") ||
    lower.includes("maximum context length") ||
    // Google
    lower.includes("input token limit") ||
    lower.includes("resource_exhausted") ||
    // Generic patterns
    lower.includes("too many tokens") ||
    lower.includes("token limit exceeded") ||
    // Anthropic pattern: "X tokens > Y maximum"
    /\d+ tokens? > \d+ maximum/.test(lower)
  );
}

export class PromptExecutor {
  private deps: PromptExecutorDeps;

  constructor(deps: PromptExecutorDeps) {
    this.deps = deps;
  }

  /**
   * Run the agent loop: generate responses, execute tools, repeat
   * until the LLM produces a response with no tool calls or the
   * iteration limit is hit.
   */
  async runAgentLoop(): Promise<Message> {
    const provider = this.deps.getProvider();
    if (!provider) {
      throw new Error(
        `No provider available. Register a provider plugin or call setProvider().`
      );
    }
    const maxIterations = 200;
    const loopDetectionWindow = 5;
    const recentToolCalls: string[] = [];

    for (let iterations = 0; iterations < maxIterations; iterations++) {
      // Auto-compaction check — only on the first iteration (start of a new
      // user turn) to avoid interrupting mid-turn tool execution flows.
      if (iterations === 0 && this.deps.shouldAutoCompact()) {
        const compactionStats = this.deps.checkCompactionNeeded();
        if (compactionStats) {
          this.deps.emitEvent({
            type: "compaction.start",
            stats: compactionStats,
          });

          try {
            const result = await this.deps.runCompaction((delta) => {
              this.deps.emitEvent({ type: "compaction.delta", delta });
            });
            this.deps.emitEvent({
              type: "compaction.complete",
              compactionId: result.compactionId,
              stats: {
                originalTokens: result.originalTokens,
                compactedTokens: result.compactedTokens,
                messagesPruned: result.messagesPruned,
                compressionRatio: result.compressionRatio,
              },
              contextUsage: this.getContextUsage(),
            });
          } catch (err) {
            this.deps.emitEvent({
              type: "compaction.error",
              error: (err as Error).message,
            });
          }
        }
      }

      const assistantMessage = await this.generateResponse();
      await this.deps.pushMessage(assistantMessage);

      if (!assistantMessage.toolCalls?.length) {
        // No tools to execute. The turn is only "complete" if the model
        // actually finished cleanly (end_turn / stop). For max_tokens,
        // content_filter, refusal, pause_turn, error, etc., returning would
        // silently treat a truncated/blocked response as success.
        //
        // Older providers (or test mocks) may not report a finishReason at
        // all; preserve the legacy "no tools = done" behaviour in that case
        // rather than break callers.
        const reason = assistantMessage.finishReason;
        if (reason === undefined || reason === "stop" || reason === "tool_calls") {
          return assistantMessage;
        }
        throw new IncompleteResponseError(reason, assistantMessage.content);
      }

      const callSignature = assistantMessage.toolCalls
        .map((tc) => `${tc.name}:${JSON.stringify(tc.arguments)}`)
        .sort()
        .join("|");

      recentToolCalls.push(callSignature);
      if (recentToolCalls.length > loopDetectionWindow) {
        recentToolCalls.shift();
      }

      if (recentToolCalls.length === loopDetectionWindow) {
        const allSame = recentToolCalls.every((sig) => sig === recentToolCalls[0]);
        if (allSame) {
          throw new Error(
            `Agent stuck in loop: repeatedly calling same tools with same arguments`
          );
        }
      }

      const toolResults = await this.deps.executeTools(
        assistantMessage.id,
        assistantMessage.toolCalls
      );

      const toolResultMessage: Message = {
        id: generateId(),
        role: "user",
        content: "",
        toolResults,
        createdAt: Date.now(),
      };
      await this.deps.pushMessage(toolResultMessage);
    }

    throw new Error("Agent loop exceeded maximum iterations (200)");
  }

  /**
   * Generate a single LLM response by streaming from the provider.
   * Includes pre-send context validation and reactive error recovery
   * for context-length overflow.
   */
  async generateResponse(): Promise<Message> {
    const provider = this.deps.getProvider();
    if (!provider) {
      throw new Error("No provider configured");
    }

    const config = this.deps.getConfig();
    const messageId = generateId();

    this.deps.emitEvent({ type: "message.start", messageId });

    let llmMessages = this.buildLLMMessages();
    const tools = this.deps.getToolRegistry().toLLMTools(config.tools, config.disabledTools);
    const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    // --- Layer 2: Pre-send context validation ---
    llmMessages = await this.ensureContextFits(
      llmMessages, tools, systemPrompt, config.model
    );

    // --- Layer 3: Call provider with reactive error recovery ---
    try {
      return await this.streamProviderResponse(
        provider, config, messageId, llmMessages, tools, systemPrompt
      );
    } catch (err) {
      if (!isContextLengthError(err)) {
        throw err;
      }

      // Context-length error from the provider — our pre-send estimate was wrong.
      // Try emergency compaction + truncation, then retry once.
      this.deps.emitEvent({
        type: "compaction.start",
        stats: { currentTokens: 0, threshold: 0, messagesToCompact: 0 },
      });

      try {
        const result = await this.deps.runCompaction((delta) => {
          this.deps.emitEvent({ type: "compaction.delta", delta });
        });
        this.deps.emitEvent({
          type: "compaction.complete",
          compactionId: result.compactionId,
          stats: {
            originalTokens: result.originalTokens,
            compactedTokens: result.compactedTokens,
            messagesPruned: result.messagesPruned,
            compressionRatio: result.compressionRatio,
          },
          contextUsage: this.getContextUsage(),
        });
      } catch (compactionErr) {
        this.deps.emitEvent({
          type: "compaction.error",
          error: (compactionErr as Error).message,
        });
      }

      // Rebuild messages after compaction and apply truncation
      llmMessages = this.buildLLMMessages();
      llmMessages = this.truncateMessages(
        llmMessages, tools, systemPrompt, config.model
      );

      try {
        return await this.streamProviderResponse(
          provider, config, messageId, llmMessages, tools, systemPrompt
        );
      } catch (retryErr) {
        if (isContextLengthError(retryErr)) {
          throw new Error(
            "Conversation exceeds model context limit even after compaction. " +
            "Use /compact or start a new session."
          );
        }
        throw retryErr;
      }
    }
  }

  /**
   * Pre-send validation: estimate payload size and compact/truncate
   * if it would exceed the model's context limit.
   */
  private async ensureContextFits(
    llmMessages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    model: string
  ): Promise<LLMMessage[]> {
    const modelLimit = getModelLimit(model);
    const estimatedTokens = estimatePayloadTokens(systemPrompt, llmMessages, tools);

    // Leave 5% headroom for estimation inaccuracy
    const safeLimit = Math.floor(modelLimit * 0.95);

    if (estimatedTokens <= safeLimit) {
      return llmMessages;
    }

    // Over the safe limit — try compaction first
    this.deps.emitEvent({
      type: "compaction.start",
      stats: {
        currentTokens: estimatedTokens,
        threshold: safeLimit,
        messagesToCompact: llmMessages.length,
      },
    });

    try {
      const result = await this.deps.runCompaction((delta) => {
        this.deps.emitEvent({ type: "compaction.delta", delta });
      });
      this.deps.emitEvent({
        type: "compaction.complete",
        compactionId: result.compactionId,
        stats: {
          originalTokens: result.originalTokens,
          compactedTokens: result.compactedTokens,
          messagesPruned: result.messagesPruned,
          compressionRatio: result.compressionRatio,
        },
        contextUsage: this.getContextUsage(),
      });

      // Rebuild messages after compaction
      llmMessages = this.buildLLMMessages();
    } catch (err) {
      this.deps.emitEvent({
        type: "compaction.error",
        error: (err as Error).message,
      });
    }

    // Check again — if still over, truncate
    const postCompactionTokens = estimatePayloadTokens(systemPrompt, llmMessages, tools);
    if (postCompactionTokens > safeLimit) {
      llmMessages = this.truncateMessages(llmMessages, tools, systemPrompt, model);
    }

    return llmMessages;
  }

  /**
   * Progressively drop oldest messages (preserving the first message
   * and the last user message + any trailing tool results) until
   * the payload fits within the model's context limit.
   */
  private truncateMessages(
    llmMessages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string,
    model: string
  ): LLMMessage[] {
    const modelLimit = getModelLimit(model);
    // Use 90% limit for truncation — more aggressive than pre-send (95%)
    // to ensure we have room for the model's response.
    const safeLimit = Math.floor(modelLimit * 0.90);

    // Need at least 2 messages to truncate (keep first + last)
    while (llmMessages.length > 2) {
      const currentTokens = estimatePayloadTokens(systemPrompt, llmMessages, tools);
      if (currentTokens <= safeLimit) {
        break;
      }

      // Remove the second message (index 1), preserving:
      // - index 0: first message (compaction summary or first user message)
      // - last messages: the most recent context
      //
      // If removing index 1 would break a tool call/result pair (assistant
      // with toolCalls followed by user with toolResults), remove both.
      const removed = llmMessages.splice(1, 1);
      const removedMsg = removed[0];

      // If we removed an assistant message with tool calls, and the new index 1
      // is a user message with tool results, remove it too (orphaned results).
      if (
        removedMsg?.toolCalls?.length &&
        llmMessages.length > 1 &&
        llmMessages[1]?.toolResults?.length
      ) {
        llmMessages.splice(1, 1);
      }

      // If we removed a user message with tool results, and the new index 1
      // is the same (unlikely but guard against it), skip.
    }

    return llmMessages;
  }

  /**
   * Stream a response from the LLM provider and collect the result.
   * Extracted to allow retry on context-length errors.
   */
  private async streamProviderResponse(
    provider: LLMProvider,
    config: AgentConfig,
    messageId: string,
    llmMessages: LLMMessage[],
    tools: LLMTool[],
    systemPrompt: string
  ): Promise<Message> {
    const { stream, response } = await provider.stream({
      model: config.model,
      messages: llmMessages,
      tools: tools.length > 0 ? tools : undefined,
      system: systemPrompt,
      abortSignal: this.deps.getAbortSignal(),
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });

    let content = "";
    const toolCalls: ToolCall[] = [];
    let finishReason: FinishReason | undefined;

    for await (const chunk of stream) {
      if (chunk.type === "text" && chunk.text) {
        content += chunk.text;
        this.deps.emitEvent({
          type: "message.delta",
          messageId,
          delta: chunk.text,
        });
      } else if (chunk.type === "tool_call" && chunk.toolCall) {
        toolCalls.push(chunk.toolCall);
        this.deps.emitEvent({
          type: "tool.start",
          messageId,
          toolCall: chunk.toolCall,
        });
      }
    }

    const finalResponse = await response;
    if (finalResponse.toolCalls.length > toolCalls.length) {
      for (const tc of finalResponse.toolCalls.slice(toolCalls.length)) {
        toolCalls.push(tc);
        this.deps.emitEvent({
          type: "tool.start",
          messageId,
          toolCall: tc,
        });
      }
    }
    finishReason = finalResponse.finishReason;

    // Record token usage (including cache token stats when available)
    if (finalResponse.usage) {
      this.deps.getUsageTracker().record(
        this.deps.getSessionId() ?? "default",
        config.model,
        config.provider,
        {
          promptTokens: finalResponse.usage.promptTokens,
          completionTokens: finalResponse.usage.completionTokens,
          totalTokens: finalResponse.usage.totalTokens,
          cacheCreationInputTokens: finalResponse.usage.cacheCreationInputTokens,
          cacheReadInputTokens: finalResponse.usage.cacheReadInputTokens,
        }
      );
    }

    this.deps.emitEvent({
      type: "message.complete",
      messageId,
      content,
      finishReason,
      contextUsage: this.getContextUsage(),
    });

    return {
      id: messageId,
      role: "assistant",
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      createdAt: Date.now(),
    };
  }

  /**
   * Compute the current context window usage for inclusion in events.
   */
  private getContextUsage(): { currentTokens: number; maxTokens: number } {
    const config = this.deps.getConfig();
    const maxTokens = getModelLimit(config.model);
    const llmMessages = this.buildLLMMessages();
    const tools = this.deps.getToolRegistry().toLLMTools(config.tools, config.disabledTools);
    const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const currentTokens = estimatePayloadTokens(systemPrompt, llmMessages, tools);
    return { currentTokens, maxTokens };
  }

  /**
   * Build the LLM message array from the working window.
   * The working window is everything from the last compaction summary
   * to the end of the conversation.
   */
  buildLLMMessages(): LLMMessage[] {
    const llmMessages: LLMMessage[] = [];
    const messages = this.deps.getWorkingWindow();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      const nextMsg = messages[i + 1];

      if (msg.role === "user") {
        if (msg.toolResults?.length) {
          llmMessages.push({
            role: "user",
            content: "",
            toolResults: msg.toolResults,
          });
        } else {
          llmMessages.push({ role: "user", content: msg.content });
        }
      } else {
        const hasToolCalls = msg.toolCalls?.length;
        const nextHasToolResults = nextMsg?.toolResults?.length;

        if (hasToolCalls && !nextHasToolResults) {
          llmMessages.push({
            role: "assistant",
            content: msg.content,
          });
        } else {
          llmMessages.push({
            role: "assistant",
            content: msg.content,
            toolCalls: msg.toolCalls,
          });
        }
      }
    }

    return llmMessages;
  }
}
