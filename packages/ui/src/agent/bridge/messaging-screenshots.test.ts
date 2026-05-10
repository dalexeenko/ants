import { describe, it, expect } from 'vitest';
import { resolveImageUrl, buildContentBlocksFromHistory } from './messaging';
import type { HistoryBlockOptions } from './messaging';
import type { Message } from '../types';

describe('resolveImageUrl', () => {
  it('returns dataUrl when present', () => {
    const url = resolveImageUrl({ dataUrl: 'data:image/png;base64,abc' });
    expect(url).toBe('data:image/png;base64,abc');
  });

  it('resolves file path via platform resolver', () => {
    const opts: HistoryBlockOptions = {
      projectId: 'proj-1',
      resolveScreenshotUrl: (pid, path) => `openmgr-screenshot://${pid}/${path}`,
    };
    const url = resolveImageUrl({ path: 'screenshots/abc.png' }, opts);
    expect(url).toBe('openmgr-screenshot://proj-1/screenshots/abc.png');
  });

  it('returns undefined when no dataUrl and no resolver', () => {
    const url = resolveImageUrl({ path: 'screenshots/abc.png' });
    expect(url).toBeUndefined();
  });

  it('prefers dataUrl over path', () => {
    const opts: HistoryBlockOptions = {
      projectId: 'proj-1',
      resolveScreenshotUrl: () => 'resolved',
    };
    const url = resolveImageUrl({ dataUrl: 'data:image/png;base64,abc', path: 'screenshots/x.png' }, opts);
    expect(url).toBe('data:image/png;base64,abc');
  });
});

describe('buildContentBlocksFromHistory', () => {
  it('returns undefined for messages without tool calls', () => {
    const msg: Message = { id: '1', role: 'assistant', content: 'Hello', createdAt: Date.now() };
    expect(buildContentBlocksFromHistory(msg)).toBeUndefined();
  });

  it('adds image block for tool call with screenshot metadata (dataUrl)', () => {
    const msg: Message = {
      id: '1',
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      toolCalls: [{
        id: 'tc-1',
        name: 'browser_screenshot',
        arguments: {},
        status: 'complete',
        result: 'Screenshot taken',
        metadata: { image: { dataUrl: 'data:image/png;base64,abc', width: 800, height: 600 } },
      }],
    };

    const blocks = buildContentBlocksFromHistory(msg)!;
    expect(blocks).toHaveLength(2); // tool_call + image
    expect(blocks[0]!.type).toBe('tool_call');
    expect(blocks[1]!.type).toBe('image');
    expect((blocks[1] as any).dataUrl).toBe('data:image/png;base64,abc');
    expect((blocks[1] as any).width).toBe(800);
  });

  it('resolves file path screenshots with opts', () => {
    const msg: Message = {
      id: '1',
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      toolCalls: [{
        id: 'tc-1',
        name: 'browser_screenshot',
        arguments: {},
        status: 'complete',
        result: 'Screenshot taken',
        metadata: { image: { path: 'screenshots/abc.png', width: 1024, height: 768 } },
      }],
    };

    const opts: HistoryBlockOptions = {
      projectId: 'proj-1',
      resolveScreenshotUrl: (pid, path) => `/api/beta/projects/${pid}/${path}`,
    };

    const blocks = buildContentBlocksFromHistory(msg, opts)!;
    expect(blocks).toHaveLength(2);
    expect((blocks[1] as any).dataUrl).toBe('/api/beta/projects/proj-1/screenshots/abc.png');
  });

  it('skips image block when path cannot be resolved (no opts)', () => {
    const msg: Message = {
      id: '1',
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      toolCalls: [{
        id: 'tc-1',
        name: 'browser_screenshot',
        arguments: {},
        status: 'complete',
        result: 'done',
        metadata: { image: { path: 'screenshots/abc.png' } },
      }],
    };

    const blocks = buildContentBlocksFromHistory(msg)!;
    // Should only have the tool_call block, no image
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('tool_call');
  });
});
