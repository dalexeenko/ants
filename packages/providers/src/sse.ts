/**
 * Server-Sent Events (SSE) parser.
 * 
 * This is a simple, cross-platform SSE parser that works with any fetch implementation.
 * It reads text from a ReadableStream and yields parsed SSE events.
 * 
 * Supports both:
 * - Async iterable streams (expo/fetch in React Native)
 * - ReadableStream with getReader() (standard Web Streams API)
 */

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

/**
 * Parse a single SSE block into an event object.
 */
function parseSSEBlock(block: string): SSEEvent | null {
  const lines = block.split("\n");
  let event: string | undefined;
  const data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trim());
    } else if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    } else if (line.startsWith("retry:")) {
      const retryValue = parseInt(line.slice(6).trim(), 10);
      if (!isNaN(retryValue)) {
        retry = retryValue;
      }
    }
    // Lines starting with ":" are comments, ignore them
    // Empty lines are handled by the split above
  }

  if (data.length === 0) {
    return null;
  }

  return {
    event,
    data: data.join("\n"),
    id,
    retry,
  };
}

/**
 * Parse a stream of SSE data into individual events.
 * 
 * Supports both async iterable streams (expo/fetch) and ReadableStream (Web Streams API).
 * 
 * SSE format:
 * ```
 * event: message_start
 * data: {"type": "message_start", ...}
 * 
 * event: content_block_delta
 * data: {"type": "content_block_delta", ...}
 * ```
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = "";

  // Helper to process a chunk and yield events
  const processChunk = (value: Uint8Array): SSEEvent[] => {
    buffer += decoder.decode(value, { stream: true });
    
    // SSE events are separated by double newlines
    const parts = buffer.split(/\n\n/);
    
    // Keep the last part in the buffer (it might be incomplete)
    buffer = parts.pop() || "";

    // Return all complete events
    const events: SSEEvent[] = [];
    for (const part of parts) {
      if (part.trim()) {
        const event = parseSSEBlock(part);
        if (event) {
          events.push(event);
        }
      }
    }
    return events;
  };

  // Helper to process remaining buffer
  const processRemainingBuffer = (): SSEEvent | null => {
    if (buffer.trim()) {
      return parseSSEBlock(buffer);
    }
    return null;
  };

  // Try async iteration first (works with expo/fetch in React Native)
  if (Symbol.asyncIterator in stream) {
    try {
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        if (signal?.aborted) break;
        for (const event of processChunk(chunk)) {
          yield event;
        }
      }
      // Process any remaining data
      const remaining = processRemainingBuffer();
      if (remaining) yield remaining;
      return;
    } catch {
      // Fall through to getReader approach if async iteration fails
    }
  }

  // Fall back to getReader (standard Web Streams API)
  const readableStream = stream as ReadableStream<Uint8Array>;
  if (typeof readableStream.getReader !== "function") {
    throw new Error("Stream does not support async iteration or getReader()");
  }

  const reader = readableStream.getReader();
  
  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      
      if (done) {
        // Process any remaining data in buffer
        const remaining = processRemainingBuffer();
        if (remaining) yield remaining;
        break;
      }

      for (const event of processChunk(value)) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Helper to read a response body as an SSE stream.
 * Works with any Response object (native fetch, expo/fetch, etc.)
 */
export async function* readSSEResponse(
  response: Response,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent> {
  if (!response.body) {
    throw new Error("Response has no body");
  }

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

  yield* parseSSEStream(response.body, signal);
}
