/**
 * SessionEventBuffer - Buffers SSE events per session on the server.
 *
 * This enables:
 * 1. Disconnected clients to reconnect and replay missed events
 * 2. Multiple clients to subscribe to the same session's events simultaneously
 * 3. New clients to attach to an in-progress session and see all events from the start
 *
 * Events are buffered for the duration of an active prompt, plus a configurable
 * retention period after completion so clients can catch up.
 */

/** A single buffered SSE event with a monotonic index for replay */
export interface BufferedEvent {
  /** Monotonic index within this session's prompt run (0-based) */
  index: number;
  /** SSE event type (e.g. 'message.delta', 'tool.start', 'done') */
  type: string;
  /** The event data payload (already JSON-serializable) */
  data: unknown;
  /** Timestamp when the event was buffered */
  timestamp: number;
}

/** Status of a session's prompt processing */
export type SessionStatus = 'idle' | 'active' | 'completed' | 'error' | 'aborted';

/** Information about a session's current state */
export interface SessionStreamInfo {
  status: SessionStatus;
  /** Total number of events buffered for the current/last prompt run */
  eventCount: number;
  /** Timestamp when the prompt started */
  startedAt: number | null;
  /** Timestamp when the prompt completed/errored */
  completedAt: number | null;
  /** The final assistant message (if completed) */
  finalMessage?: string;
  /** Error message (if errored) */
  error?: string;
}

/** Callback type for event subscribers */
type EventSubscriber = (event: BufferedEvent) => void;

/** Internal session state */
interface SessionBuffer {
  status: SessionStatus;
  events: BufferedEvent[];
  subscribers: Set<EventSubscriber>;
  startedAt: number | null;
  completedAt: number | null;
  finalMessage?: string;
  error?: string;
  /** Timer for cleaning up completed session buffers */
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

/** How long to retain completed session buffers (ms) */
const BUFFER_RETENTION_MS = 5 * 60 * 1000; // 5 minutes after completion

export class SessionEventBuffer {
  private sessions: Map<string, SessionBuffer> = new Map();

  /**
   * Mark a session as active (prompt processing started).
   * Clears any previous buffer for this session.
   */
  startSession(sessionId: string): void {
    // Clean up any existing buffer
    const existing = this.sessions.get(sessionId);
    if (existing?.cleanupTimer) {
      clearTimeout(existing.cleanupTimer);
    }

    this.sessions.set(sessionId, {
      status: 'active',
      events: [],
      subscribers: existing?.subscribers ?? new Set(),
      startedAt: Date.now(),
      completedAt: null,
    });
  }

  /**
   * Push an event into the session's buffer and notify all subscribers.
   */
  pushEvent(sessionId: string, type: string, data: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const event: BufferedEvent = {
      index: session.events.length,
      type,
      data,
      timestamp: Date.now(),
    };

    session.events.push(event);

    // Notify all live subscribers
    for (const subscriber of session.subscribers) {
      try {
        subscriber(event);
      } catch {
        // Don't let one subscriber's error affect others
      }
    }

    if (type === 'error') {
      this.errorSession(sessionId, getErrorMessage(data));
    }
  }

  /**
   * Mark a session as completed with the final assistant message.
   */
  completeSession(sessionId: string, finalMessage?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // If already aborted or errored, don't overwrite the terminal state when
    // the upstream stream eventually closes.
    if (session.status === 'aborted' || session.status === 'error') return;

    session.status = 'completed';
    session.completedAt = Date.now();
    session.finalMessage = finalMessage;

    // Schedule cleanup after retention period
    session.cleanupTimer = setTimeout(() => {
      // Only clean up if still completed (not restarted)
      const current = this.sessions.get(sessionId);
      if (current && current.status === 'completed' && current.subscribers.size === 0) {
        this.sessions.delete(sessionId);
      }
    }, BUFFER_RETENTION_MS);
  }

  /**
   * Mark a session as errored.
   */
  errorSession(sessionId: string, error: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // If already aborted, don't downgrade to error — the abort
    // was user-initiated and the trailing error is just the abort
    // signal propagating through the stream.
    if (session.status === 'aborted') return;

    session.status = 'error';
    session.completedAt = Date.now();
    session.error = error;

    // Schedule cleanup
    session.cleanupTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (current && current.status === 'error' && current.subscribers.size === 0) {
        this.sessions.delete(sessionId);
      }
    }, BUFFER_RETENTION_MS);
  }

  /**
   * Mark a session as aborted (user-initiated cancellation).
   * This immediately transitions the session out of 'active' so a new
   * prompt can be sent to the same session without waiting for the
   * upstream stream to fully unwind.
   */
  abortSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'aborted';
    session.completedAt = Date.now();

    // Schedule cleanup
    session.cleanupTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (current && current.status === 'aborted' && current.subscribers.size === 0) {
        this.sessions.delete(sessionId);
      }
    }, BUFFER_RETENTION_MS);
  }

  /**
   * Subscribe to a session's events. Optionally replay from a given event index.
   *
   * @param sessionId - The session to subscribe to
   * @param subscriber - Callback for each event
   * @param fromIndex - If provided, replay all events from this index before live events
   * @returns Unsubscribe function
   */
  subscribe(
    sessionId: string,
    subscriber: EventSubscriber,
    fromIndex?: number,
  ): (() => void) | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Replay buffered events if requested
    if (fromIndex !== undefined && fromIndex >= 0) {
      const replayEvents = session.events.slice(fromIndex);
      for (const event of replayEvents) {
        try {
          subscriber(event);
        } catch {
          // Subscriber error during replay
        }
      }
    }

    // Add to live subscribers
    session.subscribers.add(subscriber);

    // Return unsubscribe function
    return () => {
      session.subscribers.delete(subscriber);
    };
  }

  /**
   * Get the current status/info for a session.
   */
  getSessionInfo(sessionId: string): SessionStreamInfo {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        status: 'idle',
        eventCount: 0,
        startedAt: null,
        completedAt: null,
      };
    }

    return {
      status: session.status,
      eventCount: session.events.length,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      finalMessage: session.finalMessage,
      error: session.error,
    };
  }

  /**
   * Check if a session is currently active (processing a prompt).
   */
  isActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.status === 'active';
  }

  /**
   * Get buffered events for a session, optionally from a given index.
   */
  getEvents(sessionId: string, fromIndex = 0): BufferedEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.events.slice(fromIndex);
  }

  /**
   * Clean up all session buffers. Called on server shutdown.
   */
  shutdown(): void {
    for (const [, session] of this.sessions) {
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
      }
      session.subscribers.clear();
    }
    this.sessions.clear();
  }
}

function getErrorMessage(data: unknown): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.message === 'string') return record.message;
  }
  return 'Agent stream error';
}
