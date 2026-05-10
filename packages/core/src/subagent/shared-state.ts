/**
 * SharedState - A thread-safe key-value store for inter-subagent communication.
 * 
 * Parent agents can create a SharedState instance and pass it to subagents
 * via the tool context extensions. Subagents can read/write values and
 * subscribe to changes from sibling subagents.
 * 
 * This enables patterns like:
 * - Subagent A discovers a file path, subagent B reads it
 * - Subagent A posts partial results, parent agent monitors progress
 * - Multiple subagents coordinate via a shared task queue
 */

import { EventEmitter } from "eventemitter3";

export interface SharedStateEntry<T = unknown> {
  key: string;
  value: T;
  updatedBy: string;  // session ID of the writer
  updatedAt: number;
  version: number;
}

export interface SharedStateEvents {
  change: (entry: SharedStateEntry) => void;
  delete: (key: string, deletedBy: string) => void;
}

export class SharedState extends EventEmitter<SharedStateEvents> {
  private store: Map<string, SharedStateEntry> = new Map();

  /**
   * Get a value by key.
   */
  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key)?.value as T | undefined;
  }

  /**
   * Get a full entry (value + metadata) by key.
   */
  getEntry<T = unknown>(key: string): SharedStateEntry<T> | undefined {
    return this.store.get(key) as SharedStateEntry<T> | undefined;
  }

  /**
   * Set a value.
   * @param key - The key to set
   * @param value - The value to store
   * @param writerId - The session ID of the writer (for tracking who set it)
   */
  set<T = unknown>(key: string, value: T, writerId: string): void {
    const existing = this.store.get(key);
    const entry: SharedStateEntry<T> = {
      key,
      value,
      updatedBy: writerId,
      updatedAt: Date.now(),
      version: (existing?.version ?? 0) + 1,
    };
    this.store.set(key, entry as SharedStateEntry);
    this.emit("change", entry as SharedStateEntry);
  }

  /**
   * Delete a key.
   */
  delete(key: string, deletedBy: string): boolean {
    const existed = this.store.delete(key);
    if (existed) {
      this.emit("delete", key, deletedBy);
    }
    return existed;
  }

  /**
   * Check if a key exists.
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Get all keys.
   */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Get all entries.
   */
  entries(): SharedStateEntry[] {
    return Array.from(this.store.values());
  }

  /**
   * Get all entries as a plain object.
   */
  toJSON(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [key, entry] of this.store) {
      obj[key] = entry.value;
    }
    return obj;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the number of entries.
   */
  get size(): number {
    return this.store.size;
  }
}

/**
 * MessageBus - Simple pub/sub for inter-subagent message passing.
 * 
 * Subagents can publish messages to named channels and subscribe to
 * messages from other subagents.
 */
export interface BusMessage<T = unknown> {
  channel: string;
  payload: T;
  senderId: string;  // session ID of the sender
  sentAt: number;
  id: string;
}

export interface MessageBusEvents {
  message: (msg: BusMessage) => void;
}

export class MessageBus extends EventEmitter<MessageBusEvents> {
  private channels: Map<string, Array<(msg: BusMessage) => void>> = new Map();
  private messageCounter = 0;

  /**
   * Publish a message to a channel.
   */
  publish<T = unknown>(channel: string, payload: T, senderId: string): BusMessage<T> {
    const msg: BusMessage<T> = {
      channel,
      payload,
      senderId,
      sentAt: Date.now(),
      id: `msg_${++this.messageCounter}`,
    };

    // Emit global event
    this.emit("message", msg as BusMessage);

    // Notify channel subscribers
    const subscribers = this.channels.get(channel);
    if (subscribers) {
      for (const handler of subscribers) {
        handler(msg as BusMessage);
      }
    }

    return msg;
  }

  /**
   * Subscribe to messages on a channel.
   * Returns an unsubscribe function.
   */
  subscribe(channel: string, handler: (msg: BusMessage) => void): () => void {
    let subscribers = this.channels.get(channel);
    if (!subscribers) {
      subscribers = [];
      this.channels.set(channel, subscribers);
    }
    subscribers.push(handler);

    return () => {
      const subs = this.channels.get(channel);
      if (subs) {
        const idx = subs.indexOf(handler);
        if (idx >= 0) {
          subs.splice(idx, 1);
        }
        if (subs.length === 0) {
          this.channels.delete(channel);
        }
      }
    };
  }

  /**
   * Get all channel names that have subscribers.
   */
  getChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Remove all subscribers from a channel.
   */
  clearChannel(channel: string): void {
    this.channels.delete(channel);
  }

  /**
   * Remove all subscribers from all channels.
   */
  clearAll(): void {
    this.channels.clear();
  }
}
