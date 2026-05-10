import { describe, it, expect, vi } from 'vitest';
import { questionTool } from '../question.js';
import type { ToolContext, AgentEvent, QuestionResponse } from '@ants/agent-core';

// Mock agent with question resolver infrastructure
function createMockAgent() {
  const resolvers = new Map<string, (response: QuestionResponse) => void>();

  return {
    registerQuestionResolver(id: string, resolver: (response: QuestionResponse) => void) {
      resolvers.set(id, resolver);
    },
    respondToQuestion(id: string, response: QuestionResponse) {
      const resolver = resolvers.get(id);
      if (resolver) {
        resolver(response);
        resolvers.delete(id);
      }
    },
    hasPendingQuestion(id: string) {
      return resolvers.has(id);
    },
    _resolvers: resolvers,
  };
}

function createMockContext(options: {
  hasAgent?: boolean;
  hasEmitEvent?: boolean;
} = {}): { ctx: ToolContext; emittedEvents: AgentEvent[]; agent: ReturnType<typeof createMockAgent> } {
  const { hasAgent = true, hasEmitEvent = true } = options;
  const emittedEvents: AgentEvent[] = [];
  const agent = createMockAgent();

  const ctx: Partial<ToolContext> = {
    workingDirectory: '/test',
    abortSignal: new AbortController().signal,
    extensions: {},
  };

  if (hasAgent) {
    ctx.getAgent = () => agent;
  }

  if (hasEmitEvent) {
    ctx.emitEvent = (event: AgentEvent) => {
      emittedEvents.push(event);
    };
  }

  return { ctx: ctx as ToolContext, emittedEvents, agent };
}

describe('questionTool', () => {
  it('should have correct metadata', () => {
    expect(questionTool.name).toBe('question');
    expect(questionTool.description).toBeDefined();
    expect(questionTool.description.length).toBeGreaterThan(0);
  });

  it('should return error when agent is not available', async () => {
    const { ctx } = createMockContext({ hasAgent: false });
    const result = await questionTool.execute(
      {
        question: 'Pick one',
        options: [{ label: 'A' }, { label: 'B' }],
        multiple: false,
      },
      ctx,
    );

    expect(result.output).toContain('not available');
    expect(result.metadata?.error).toBe(true);
  });

  it('should return error when emitEvent is not available', async () => {
    const { ctx } = createMockContext({ hasEmitEvent: false });
    const result = await questionTool.execute(
      {
        question: 'Pick one',
        options: [{ label: 'A' }, { label: 'B' }],
        multiple: false,
      },
      ctx,
    );

    expect(result.output).toContain('not available');
    expect(result.metadata?.error).toBe(true);
  });

  it('should emit question.request event', async () => {
    const { ctx, emittedEvents, agent } = createMockContext();

    // Respond immediately in the background
    const executePromise = questionTool.execute(
      {
        question: 'Which framework?',
        options: [
          { label: 'React', description: 'A JS library' },
          { label: 'Vue', description: 'A progressive framework' },
        ],
        multiple: false,
      },
      ctx,
    );

    // Wait a tick for the event to be emitted
    await new Promise((r) => setTimeout(r, 0));

    // Verify the event was emitted
    expect(emittedEvents).toHaveLength(1);
    const event = emittedEvents[0] as Extract<AgentEvent, { type: 'question.request' }>;
    expect(event.type).toBe('question.request');
    expect(event.question).toBe('Which framework?');
    expect(event.options).toHaveLength(2);
    expect(event.options[0].label).toBe('React');
    expect(event.options[0].description).toBe('A JS library');
    expect(event.options[1].label).toBe('Vue');
    expect(event.multiple).toBe(false);
    expect(event.allowFreeform).toBe(true);
    expect(event.questionId).toBeDefined();

    // Now respond to unblock the tool
    agent.respondToQuestion(event.questionId, { selected: ['React'] });

    const result = await executePromise;
    expect(result.output).toContain('React');
  });

  it('should return single selected option', async () => {
    const { ctx, emittedEvents, agent } = createMockContext();

    const executePromise = questionTool.execute(
      {
        question: 'Pick one',
        options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        multiple: false,
      },
      ctx,
    );

    await new Promise((r) => setTimeout(r, 0));

    const event = emittedEvents[0] as Extract<AgentEvent, { type: 'question.request' }>;
    agent.respondToQuestion(event.questionId, { selected: ['B'] });

    const result = await executePromise;
    expect(result.output).toBe('User selected: "B"');
    expect(result.metadata?.selected).toEqual(['B']);
  });

  it('should return multiple selected options', async () => {
    const { ctx, emittedEvents, agent } = createMockContext();

    const executePromise = questionTool.execute(
      {
        question: 'Pick many',
        options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        multiple: true,
      },
      ctx,
    );

    await new Promise((r) => setTimeout(r, 0));

    const event = emittedEvents[0] as Extract<AgentEvent, { type: 'question.request' }>;
    expect(event.multiple).toBe(true);

    agent.respondToQuestion(event.questionId, { selected: ['A', 'C'] });

    const result = await executePromise;
    expect(result.output).toBe('User selected: "A", "C"');
    expect(result.metadata?.selected).toEqual(['A', 'C']);
  });

  it('should handle freeform text response', async () => {
    const { ctx, emittedEvents, agent } = createMockContext();

    const executePromise = questionTool.execute(
      {
        question: 'Pick one',
        options: [{ label: 'A' }, { label: 'B' }],
        multiple: false,
      },
      ctx,
    );

    await new Promise((r) => setTimeout(r, 0));

    const event = emittedEvents[0] as Extract<AgentEvent, { type: 'question.request' }>;
    agent.respondToQuestion(event.questionId, {
      selected: [],
      freeformText: 'Actually I want something custom',
    });

    const result = await executePromise;
    expect(result.output).toContain('freeform text');
    expect(result.output).toContain('Actually I want something custom');
    expect(result.metadata?.freeformText).toBe('Actually I want something custom');
  });

  it('should handle empty selection', async () => {
    const { ctx, emittedEvents, agent } = createMockContext();

    const executePromise = questionTool.execute(
      {
        question: 'Pick one',
        options: [{ label: 'A' }, { label: 'B' }],
        multiple: false,
      },
      ctx,
    );

    await new Promise((r) => setTimeout(r, 0));

    const event = emittedEvents[0] as Extract<AgentEvent, { type: 'question.request' }>;
    agent.respondToQuestion(event.questionId, { selected: [] });

    const result = await executePromise;
    expect(result.output).toContain('did not select');
    expect(result.metadata?.selected).toEqual([]);
  });

  it('should default multiple to false', async () => {
    const { ctx, emittedEvents, agent } = createMockContext();

    const executePromise = questionTool.execute(
      {
        question: 'Pick one',
        options: [{ label: 'A' }, { label: 'B' }],
      } as Parameters<typeof questionTool.execute>[0],
      ctx,
    );

    await new Promise((r) => setTimeout(r, 0));

    const event = emittedEvents[0] as Extract<AgentEvent, { type: 'question.request' }>;
    expect(event.multiple).toBe(false);

    agent.respondToQuestion(event.questionId, { selected: ['A'] });
    await executePromise;
  });

  it('should include questionId in metadata', async () => {
    const { ctx, emittedEvents, agent } = createMockContext();

    const executePromise = questionTool.execute(
      {
        question: 'Pick one',
        options: [{ label: 'A' }, { label: 'B' }],
        multiple: false,
      },
      ctx,
    );

    await new Promise((r) => setTimeout(r, 0));

    const event = emittedEvents[0] as Extract<AgentEvent, { type: 'question.request' }>;
    agent.respondToQuestion(event.questionId, { selected: ['A'] });

    const result = await executePromise;
    expect(result.metadata?.questionId).toBe(event.questionId);
  });
});
