import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionEventBuffer, BufferedEvent } from './session-event-buffer.js';

describe('SessionEventBuffer', () => {
  let buffer: SessionEventBuffer;

  beforeEach(() => {
    vi.useFakeTimers();
    buffer = new SessionEventBuffer();
  });

  afterEach(() => {
    buffer.shutdown();
    vi.useRealTimers();
  });

  describe('startSession', () => {
    it('creates a new active session', () => {
      buffer.startSession('s1');
      expect(buffer.isActive('s1')).toBe(true);
    });

    it('reports session info correctly after start', () => {
      buffer.startSession('s1');
      const info = buffer.getSessionInfo('s1');
      expect(info.status).toBe('active');
      expect(info.eventCount).toBe(0);
      expect(info.startedAt).toBeTypeOf('number');
      expect(info.completedAt).toBeNull();
    });

    it('clears previous buffer when restarting a session', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'hello' });
      expect(buffer.getEvents('s1')).toHaveLength(1);

      buffer.startSession('s1');
      expect(buffer.getEvents('s1')).toHaveLength(0);
      expect(buffer.isActive('s1')).toBe(true);
    });

    it('preserves subscribers when restarting a session', () => {
      buffer.startSession('s1');
      const received: BufferedEvent[] = [];
      buffer.subscribe('s1', (event) => received.push(event));

      // Restart the session
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'after restart' });

      expect(received).toHaveLength(1);
      expect(received[0].data).toEqual({ text: 'after restart' });
    });

    it('clears cleanup timer from completed session on restart', () => {
      buffer.startSession('s1');
      buffer.completeSession('s1', 'done');

      // Restart before cleanup fires
      buffer.startSession('s1');
      expect(buffer.isActive('s1')).toBe(true);

      // Advance past retention period — session should still exist because it was restarted
      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(buffer.isActive('s1')).toBe(true);
    });
  });

  describe('pushEvent', () => {
    it('adds events with monotonically increasing indices', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'a' });
      buffer.pushEvent('s1', 'message.delta', { text: 'b' });
      buffer.pushEvent('s1', 'done', {});

      const events = buffer.getEvents('s1');
      expect(events).toHaveLength(3);
      expect(events[0].index).toBe(0);
      expect(events[1].index).toBe(1);
      expect(events[2].index).toBe(2);
    });

    it('stores correct type and data', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'tool.start', { toolName: 'bash' });

      const events = buffer.getEvents('s1');
      expect(events[0].type).toBe('tool.start');
      expect(events[0].data).toEqual({ toolName: 'bash' });
    });

    it('records a timestamp on each event', () => {
      const now = Date.now();
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'a' });

      const events = buffer.getEvents('s1');
      expect(events[0].timestamp).toBe(now);
    });

    it('does nothing if the session does not exist', () => {
      // Should not throw
      buffer.pushEvent('nonexistent', 'message.delta', { text: 'a' });
      expect(buffer.getEvents('nonexistent')).toEqual([]);
    });

    it('notifies subscribers immediately when an event is pushed', () => {
      buffer.startSession('s1');
      const received: BufferedEvent[] = [];
      buffer.subscribe('s1', (event) => received.push(event));

      buffer.pushEvent('s1', 'message.delta', { text: 'live' });

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('message.delta');
      expect(received[0].data).toEqual({ text: 'live' });
    });

    it('notifies multiple subscribers', () => {
      buffer.startSession('s1');
      const received1: BufferedEvent[] = [];
      const received2: BufferedEvent[] = [];
      buffer.subscribe('s1', (event) => received1.push(event));
      buffer.subscribe('s1', (event) => received2.push(event));

      buffer.pushEvent('s1', 'message.delta', { text: 'x' });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('does not fail if a subscriber throws', () => {
      buffer.startSession('s1');
      const received: BufferedEvent[] = [];

      buffer.subscribe('s1', () => {
        throw new Error('subscriber error');
      });
      buffer.subscribe('s1', (event) => received.push(event));

      buffer.pushEvent('s1', 'message.delta', { text: 'x' });

      // Second subscriber still receives the event
      expect(received).toHaveLength(1);
    });
  });

  describe('getEvents', () => {
    beforeEach(() => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'a' });
      buffer.pushEvent('s1', 'message.delta', { text: 'b' });
      buffer.pushEvent('s1', 'message.delta', { text: 'c' });
    });

    it('returns all events when no fromIndex is specified', () => {
      const events = buffer.getEvents('s1');
      expect(events).toHaveLength(3);
    });

    it('returns all events when fromIndex is 0', () => {
      const events = buffer.getEvents('s1', 0);
      expect(events).toHaveLength(3);
    });

    it('returns events from a specific index', () => {
      const events = buffer.getEvents('s1', 1);
      expect(events).toHaveLength(2);
      expect(events[0].index).toBe(1);
      expect(events[0].data).toEqual({ text: 'b' });
      expect(events[1].index).toBe(2);
    });

    it('returns events from the last index', () => {
      const events = buffer.getEvents('s1', 2);
      expect(events).toHaveLength(1);
      expect(events[0].data).toEqual({ text: 'c' });
    });

    it('returns empty array when fromIndex is beyond the buffer', () => {
      const events = buffer.getEvents('s1', 10);
      expect(events).toEqual([]);
    });

    it('returns empty array for non-existent session', () => {
      expect(buffer.getEvents('nonexistent')).toEqual([]);
      expect(buffer.getEvents('nonexistent', 5)).toEqual([]);
    });
  });

  describe('completeSession', () => {
    it('marks session as completed with a final message', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'hello' });
      buffer.completeSession('s1', 'Hello!');

      const info = buffer.getSessionInfo('s1');
      expect(info.status).toBe('completed');
      expect(info.finalMessage).toBe('Hello!');
      expect(info.completedAt).toBeTypeOf('number');
    });

    it('marks session as completed without a final message', () => {
      buffer.startSession('s1');
      buffer.completeSession('s1');

      const info = buffer.getSessionInfo('s1');
      expect(info.status).toBe('completed');
      expect(info.finalMessage).toBeUndefined();
    });

    it('does nothing for non-existent session', () => {
      // Should not throw
      buffer.completeSession('nonexistent', 'msg');
    });

    it('schedules cleanup after retention period', () => {
      buffer.startSession('s1');
      buffer.completeSession('s1', 'done');

      // Still exists before retention period
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(buffer.getSessionInfo('s1').status).toBe('completed');

      // Cleaned up after retention period (5 min)
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(buffer.getSessionInfo('s1').status).toBe('idle');
    });

    it('does not clean up completed session if subscribers remain', () => {
      buffer.startSession('s1');
      buffer.subscribe('s1', () => {});
      buffer.completeSession('s1', 'done');

      // Advance past retention
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Session still exists because it has a subscriber
      expect(buffer.getSessionInfo('s1').status).toBe('completed');
    });

    it('does not overwrite an error event when the stream later completes', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'error', { error: 'Provider failed' });

      buffer.completeSession('s1', 'partial response');

      const info = buffer.getSessionInfo('s1');
      expect(info.status).toBe('error');
      expect(info.error).toBe('Provider failed');
      expect(info.finalMessage).toBeUndefined();
    });
  });

  describe('errorSession', () => {
    it('marks session as errored with an error message', () => {
      buffer.startSession('s1');
      buffer.errorSession('s1', 'Something went wrong');

      const info = buffer.getSessionInfo('s1');
      expect(info.status).toBe('error');
      expect(info.error).toBe('Something went wrong');
      expect(info.completedAt).toBeTypeOf('number');
    });

    it('does nothing for non-existent session', () => {
      buffer.errorSession('nonexistent', 'err');
    });

    it('schedules cleanup after retention period', () => {
      buffer.startSession('s1');
      buffer.errorSession('s1', 'fail');

      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(buffer.getSessionInfo('s1').status).toBe('error');

      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(buffer.getSessionInfo('s1').status).toBe('idle');
    });

    it('does not clean up errored session if subscribers remain', () => {
      buffer.startSession('s1');
      buffer.subscribe('s1', () => {});
      buffer.errorSession('s1', 'fail');

      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(buffer.getSessionInfo('s1').status).toBe('error');
    });
  });

  describe('subscribe', () => {
    it('returns null for a non-existent session', () => {
      const unsub = buffer.subscribe('nonexistent', () => {});
      expect(unsub).toBeNull();
    });

    it('replays buffered events from a given index', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'a' });
      buffer.pushEvent('s1', 'message.delta', { text: 'b' });
      buffer.pushEvent('s1', 'message.delta', { text: 'c' });

      const received: BufferedEvent[] = [];
      buffer.subscribe('s1', (event) => received.push(event), 1);

      expect(received).toHaveLength(2);
      expect(received[0].index).toBe(1);
      expect(received[1].index).toBe(2);
    });

    it('replays all events when fromIndex is 0', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'a' });
      buffer.pushEvent('s1', 'message.delta', { text: 'b' });

      const received: BufferedEvent[] = [];
      buffer.subscribe('s1', (event) => received.push(event), 0);

      expect(received).toHaveLength(2);
    });

    it('does not replay when fromIndex is not provided', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'a' });

      const received: BufferedEvent[] = [];
      buffer.subscribe('s1', (event) => received.push(event));

      expect(received).toHaveLength(0);
    });

    it('replays nothing when fromIndex is beyond the buffer', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'a' });

      const received: BufferedEvent[] = [];
      buffer.subscribe('s1', (event) => received.push(event), 100);

      expect(received).toHaveLength(0);
    });

    it('receives live events after subscribing', () => {
      buffer.startSession('s1');
      const received: BufferedEvent[] = [];
      buffer.subscribe('s1', (event) => received.push(event));

      buffer.pushEvent('s1', 'message.delta', { text: 'live1' });
      buffer.pushEvent('s1', 'message.delta', { text: 'live2' });

      expect(received).toHaveLength(2);
    });

    it('replays and then receives live events correctly', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'buffered' });

      const received: BufferedEvent[] = [];
      buffer.subscribe('s1', (event) => received.push(event), 0);

      buffer.pushEvent('s1', 'message.delta', { text: 'live' });

      expect(received).toHaveLength(2);
      expect(received[0].data).toEqual({ text: 'buffered' });
      expect(received[1].data).toEqual({ text: 'live' });
    });

    it('returns a working unsubscribe function', () => {
      buffer.startSession('s1');
      const received: BufferedEvent[] = [];
      const unsub = buffer.subscribe('s1', (event) => received.push(event));

      buffer.pushEvent('s1', 'message.delta', { text: 'before' });
      expect(received).toHaveLength(1);

      unsub!();
      buffer.pushEvent('s1', 'message.delta', { text: 'after' });
      expect(received).toHaveLength(1);
    });

    it('handles subscriber error during replay without breaking', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'message.delta', { text: 'a' });

      let called = false;
      // The subscriber that throws during replay should not prevent subscription
      const unsub = buffer.subscribe(
        's1',
        () => {
          if (!called) {
            called = true;
            throw new Error('replay error');
          }
        },
        0,
      );

      expect(unsub).not.toBeNull();
    });
  });

  describe('getSessionInfo', () => {
    it('returns idle status for non-existent session', () => {
      const info = buffer.getSessionInfo('nonexistent');
      expect(info).toEqual({
        status: 'idle',
        eventCount: 0,
        startedAt: null,
        completedAt: null,
      });
    });

    it('returns correct event count', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'a', {});
      buffer.pushEvent('s1', 'b', {});
      buffer.pushEvent('s1', 'c', {});

      const info = buffer.getSessionInfo('s1');
      expect(info.eventCount).toBe(3);
    });

    it('includes error info for errored sessions', () => {
      buffer.startSession('s1');
      buffer.errorSession('s1', 'timeout');

      const info = buffer.getSessionInfo('s1');
      expect(info.status).toBe('error');
      expect(info.error).toBe('timeout');
    });
  });

  describe('isActive', () => {
    it('returns false for non-existent session', () => {
      expect(buffer.isActive('nonexistent')).toBe(false);
    });

    it('returns true for active session', () => {
      buffer.startSession('s1');
      expect(buffer.isActive('s1')).toBe(true);
    });

    it('returns false for completed session', () => {
      buffer.startSession('s1');
      buffer.completeSession('s1');
      expect(buffer.isActive('s1')).toBe(false);
    });

    it('returns false for errored session', () => {
      buffer.startSession('s1');
      buffer.errorSession('s1', 'err');
      expect(buffer.isActive('s1')).toBe(false);
    });
  });

  describe('multiple sessions', () => {
    it('manages independent buffers for different sessions', () => {
      buffer.startSession('s1');
      buffer.startSession('s2');

      buffer.pushEvent('s1', 'a', { from: 's1' });
      buffer.pushEvent('s2', 'b', { from: 's2' });
      buffer.pushEvent('s2', 'c', { from: 's2' });

      expect(buffer.getEvents('s1')).toHaveLength(1);
      expect(buffer.getEvents('s2')).toHaveLength(2);
      expect(buffer.getEvents('s1')[0].data).toEqual({ from: 's1' });
    });

    it('completing one session does not affect another', () => {
      buffer.startSession('s1');
      buffer.startSession('s2');

      buffer.completeSession('s1', 'done');

      expect(buffer.isActive('s1')).toBe(false);
      expect(buffer.isActive('s2')).toBe(true);
    });

    it('subscribers are session-scoped', () => {
      buffer.startSession('s1');
      buffer.startSession('s2');

      const s1Events: BufferedEvent[] = [];
      const s2Events: BufferedEvent[] = [];
      buffer.subscribe('s1', (e) => s1Events.push(e));
      buffer.subscribe('s2', (e) => s2Events.push(e));

      buffer.pushEvent('s1', 'x', {});
      buffer.pushEvent('s2', 'y', {});

      expect(s1Events).toHaveLength(1);
      expect(s1Events[0].type).toBe('x');
      expect(s2Events).toHaveLength(1);
      expect(s2Events[0].type).toBe('y');
    });
  });

  describe('shutdown', () => {
    it('clears all sessions', () => {
      buffer.startSession('s1');
      buffer.startSession('s2');
      buffer.pushEvent('s1', 'a', {});

      buffer.shutdown();

      expect(buffer.getEvents('s1')).toEqual([]);
      expect(buffer.getEvents('s2')).toEqual([]);
      expect(buffer.isActive('s1')).toBe(false);
      expect(buffer.isActive('s2')).toBe(false);
    });

    it('clears cleanup timers', () => {
      buffer.startSession('s1');
      buffer.completeSession('s1', 'done');

      buffer.shutdown();

      // Advancing timers after shutdown should not cause errors
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    it('clears all subscribers', () => {
      buffer.startSession('s1');
      const received: BufferedEvent[] = [];
      buffer.subscribe('s1', (e) => received.push(e));

      buffer.shutdown();

      // Even if we could push (which we can't since the session is gone),
      // the subscriber should have been cleared
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'a', {});
      expect(received).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty buffer gracefully', () => {
      buffer.startSession('s1');
      expect(buffer.getEvents('s1')).toEqual([]);
      expect(buffer.getSessionInfo('s1').eventCount).toBe(0);
    });

    it('handles various data types as event data', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'type1', 'string data');
      buffer.pushEvent('s1', 'type2', 42);
      buffer.pushEvent('s1', 'type3', null);
      buffer.pushEvent('s1', 'type4', [1, 2, 3]);
      buffer.pushEvent('s1', 'type5', { nested: { deep: true } });

      const events = buffer.getEvents('s1');
      expect(events).toHaveLength(5);
      expect(events[0].data).toBe('string data');
      expect(events[1].data).toBe(42);
      expect(events[2].data).toBeNull();
      expect(events[3].data).toEqual([1, 2, 3]);
      expect(events[4].data).toEqual({ nested: { deep: true } });
    });

    it('handles rapid sequential events', () => {
      buffer.startSession('s1');
      for (let i = 0; i < 1000; i++) {
        buffer.pushEvent('s1', 'message.delta', { index: i });
      }

      const events = buffer.getEvents('s1');
      expect(events).toHaveLength(1000);
      expect(events[0].index).toBe(0);
      expect(events[999].index).toBe(999);
    });

    it('getEvents returns a slice (not a reference to internal array)', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'a', {});

      const events = buffer.getEvents('s1');
      events.push({} as BufferedEvent); // mutate the returned array

      // Internal buffer should be unaffected
      expect(buffer.getEvents('s1')).toHaveLength(1);
    });

    it('subscribe with fromIndex of -1 does not replay (negative treated as >= 0 check)', () => {
      buffer.startSession('s1');
      buffer.pushEvent('s1', 'a', { text: 'x' });

      const received: BufferedEvent[] = [];
      // fromIndex = -1 fails the >= 0 check, so no replay
      buffer.subscribe('s1', (e) => received.push(e), -1);

      // No replay happened
      expect(received).toHaveLength(0);
    });
  });
});
