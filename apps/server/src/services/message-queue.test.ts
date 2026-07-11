import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { MessageQueueService } from './message-queue.js';
import { channelMessageQueue, channels } from '../db/schema.js';
import { createTestDatabase, type TestDB } from '../test-utils/db.js';

describe('MessageQueueService', () => {
  let sqlite: Database.Database;
  let db: TestDB;
  let queue: MessageQueueService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    ({ sqlite, db } = createTestDatabase());
    queue = new MessageQueueService(db, { processingTimeoutMs: 60_000, maxRetries: 3 });

    db.insert(channels).values({
      id: 'channel-1',
      type: 'slack',
      name: 'Slack',
      config: '{}',
      credentials: '{}',
      enabled: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }).run();
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
  });

  it('does not recover an old pending message until processing exceeds the timeout', () => {
    const message = queue.enqueueInbound({
      channelId: 'channel-1',
      payload: {
        id: 'msg-1',
        channelId: 'channel-1',
        platformMessageId: 'platform-msg-1',
        platformChannelId: 'platform-channel-1',
        authorId: 'user-1',
        authorName: 'User One',
        content: 'hello',
        triggerType: 'mention',
        metadata: {},
        timestamp: new Date('2026-01-01T00:00:00Z'),
      },
    });

    db.update(channelMessageQueue)
      .set({ createdAt: new Date('2025-12-31T23:58:00Z') })
      .run();

    const firstAttempt = queue.dequeue('inbound');
    expect(firstAttempt?.id).toBe(message.id);
    expect(firstAttempt?.status).toBe('processing');

    vi.setSystemTime(new Date('2026-01-01T00:00:59Z'));

    expect(queue.dequeue('inbound')).toBeNull();
    expect(queue.getMessage(message.id)?.status).toBe('processing');

    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));

    const retried = queue.dequeue('inbound');
    expect(retried?.id).toBe(message.id);
    expect(retried?.attempts).toBe(2);
  });
});
