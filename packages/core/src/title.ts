/**
 * Session title generation
 * 
 * Automatically generates a concise title for a session based on the initial messages.
 */

import type { LLMProvider, Message } from "./types.js";

const TITLE_PROMPT = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- 50 characters or less
- No explanations
</task>

<rules>
- Use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question
- Vary your phrasing - avoid repetitive patterns
- When a file is mentioned, focus on WHAT the user wants to do WITH the file
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove filler words: the, this, my, a, an
- Never assume tech stack
- Never respond to questions, just generate a title
- The title should NEVER include "summarizing" or "generating"
- Always output something meaningful, even if the input is minimal
- If the user message is short or conversational (e.g. "hello", "hi"):
  Create a title that reflects the user's tone (Greeting, Quick chat, etc.)
</rules>

<examples>
"debug 500 errors in production" → Debugging production 500 errors
"refactor user service" → Refactoring user service
"why is app.js failing" → app.js failure investigation
"implement rate limiting" → Rate limiting implementation
"how do I connect postgres to my API" → Postgres API connection
"best practices for React hooks" → React hooks best practices
"can you add refresh token support to auth.ts" → Auth refresh token support
"this parser is broken" → Parser bug fix
"look at my config" → Config review
"add dark mode toggle to App" → Dark mode toggle
</examples>`;

export interface TitleGeneratorOptions {
  /** Provider to use for title generation */
  provider: LLMProvider;
  /** Model to use (should be a small/fast model) */
  model: string;
  /** Temperature for generation (default: 0.5) */
  temperature?: number;
  /** Max tokens for title (default: 60) */
  maxTokens?: number;
}

/**
 * Generate a title for a session based on the messages
 */
export async function generateTitle(
  messages: Message[],
  options: TitleGeneratorOptions
): Promise<string> {
  const { provider, model, temperature = 0.5, maxTokens = 60 } = options;

  // Find the first user message
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (!firstUserMessage) {
    return "New conversation";
  }

  // Build context from first few messages (up to 3)
  const contextMessages = messages.slice(0, 3);
  const conversationContext = contextMessages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const titleRequest = `Generate a title for this conversation:\n\n${conversationContext}`;

  try {
    const { stream, response } = await provider.stream({
      model,
      messages: [{ role: "user", content: titleRequest }],
      system: TITLE_PROMPT,
      temperature,
      maxTokens,
    });

    // Drain the stream — some providers require the stream to be consumed
    // before the response promise resolves.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of stream) {
      // State is accumulated internally by the provider
    }

    const result = await response;
    let title = result.content.trim();

    // Clean up the title
    // Remove quotes if present
    title = title.replace(/^["']|["']$/g, "");
    // Remove "Title:" prefix if present
    title = title.replace(/^title:\s*/i, "");
    // Truncate if too long
    if (title.length > 50) {
      title = title.substring(0, 47) + "...";
    }

    return title || "New conversation";
  } catch (error) {
    // If title generation fails, return a default
    console.error("Title generation failed:", error);
    return "New conversation";
  }
}

/**
 * Check if a title is a default/placeholder title
 */
export function isDefaultTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const defaultTitles = [
    "new conversation",
    "untitled",
    "untitled session",
    "(untitled)",
    "new session",
  ];
  return defaultTitles.includes(title.toLowerCase().trim());
}
