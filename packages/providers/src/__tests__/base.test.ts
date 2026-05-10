import { describe, it, expect } from 'vitest';
import { parseSSEStream, type SSEEvent } from '../sse.js';

/**
 * Helper to create a ReadableStream from a string.
 */
function stringToStream(data: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(data);
  
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

/**
 * Helper to collect all events from an async generator.
 */
async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of parseSSEStream(stream)) {
    events.push(event);
  }
  return events;
}

describe('parseSSEStream', () => {
  it('should parse a single SSE event', async () => {
    const data = 'event: message\ndata: {"text": "hello"}\n\n';
    const events = await collectEvents(stringToStream(data));
    
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: 'message',
      data: '{"text": "hello"}',
    });
  });

  it('should parse multiple SSE events', async () => {
    const data = 'event: start\ndata: {"type": "start"}\n\nevent: delta\ndata: {"text": "hi"}\n\n';
    const events = await collectEvents(stringToStream(data));
    
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: 'start', data: '{"type": "start"}' });
    expect(events[1]).toEqual({ event: 'delta', data: '{"text": "hi"}' });
  });

  it('should handle events without event field', async () => {
    const data = 'data: {"message": "test"}\n\n';
    const events = await collectEvents(stringToStream(data));
    
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: undefined,
      data: '{"message": "test"}',
    });
  });

  it('should handle multi-line data', async () => {
    const data = 'data: line1\ndata: line2\ndata: line3\n\n';
    const events = await collectEvents(stringToStream(data));
    
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: undefined,
      data: 'line1\nline2\nline3',
    });
  });

  it('should parse id and retry fields', async () => {
    const data = 'id: msg-123\nretry: 5000\ndata: test\n\n';
    const events = await collectEvents(stringToStream(data));
    
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: undefined,
      data: 'test',
      id: 'msg-123',
      retry: 5000,
    });
  });

  it('should ignore comment lines', async () => {
    const data = ': this is a comment\ndata: actual data\n\n';
    const events = await collectEvents(stringToStream(data));
    
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: undefined,
      data: 'actual data',
    });
  });

  it('should handle empty data events', async () => {
    const data = 'event: ping\n\n';
    const events = await collectEvents(stringToStream(data));
    
    // Event with no data should be skipped
    expect(events).toHaveLength(0);
  });

  it('should handle chunked streams', async () => {
    const fullData = 'event: test\ndata: {"value": 1}\n\n';
    
    // Simulate chunked delivery
    const encoder = new TextEncoder();
    const chunks = [
      fullData.slice(0, 10),
      fullData.slice(10, 20),
      fullData.slice(20),
    ];
    
    let chunkIndex = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunkIndex < chunks.length) {
          controller.enqueue(encoder.encode(chunks[chunkIndex]));
          chunkIndex++;
        } else {
          controller.close();
        }
      }
    });

    const events = await collectEvents(stream);
    
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: 'test',
      data: '{"value": 1}',
    });
  });
});
