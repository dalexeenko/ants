import { describe, it, expect } from 'vitest';
import { todoReadTool } from '../todo-read.js';
import { todoWriteTool } from '../todo-write.js';
import type { ToolContext, TodoItem } from '@openmgr/agent-core';

// Mock tool context
function createMockContext(options: {
  todos?: TodoItem[];
  hasTodoFunctions?: boolean;
} = {}): ToolContext {
  const { todos = [], hasTodoFunctions = true } = options;
  let currentTodos = [...todos];

  const ctx: Partial<ToolContext> = {
    workingDirectory: '/test',
    abortSignal: new AbortController().signal,
    extensions: {},
  };

  if (hasTodoFunctions) {
    ctx.getTodos = () => currentTodos;
    ctx.setTodos = (newTodos: TodoItem[]) => {
      currentTodos = newTodos;
    };
  }

  return ctx as ToolContext;
}

describe('todoReadTool', () => {
  it('should have correct metadata', () => {
    expect(todoReadTool.name).toBe('todoread');
    expect(todoReadTool.description).toBeDefined();
    expect(todoReadTool.description.length).toBeGreaterThan(0);
  });

  it('should return error when getTodos not available', async () => {
    const ctx = createMockContext({ hasTodoFunctions: false });
    const result = await todoReadTool.execute({}, ctx);
    
    expect(result.output).toContain('not available');
    expect(result.metadata?.error).toBe(true);
  });

  it('should return empty message when no todos', async () => {
    const ctx = createMockContext({ todos: [] });
    const result = await todoReadTool.execute({}, ctx);
    
    expect(result.output).toBe('No todos in the current list.');
    expect(result.metadata?.count).toBe(0);
    expect(result.metadata?.todos).toEqual([]);
  });

  it('should return todos with count and pending', async () => {
    const todos: TodoItem[] = [
      { id: '1', content: 'Task 1', status: 'pending', priority: 'high' },
      { id: '2', content: 'Task 2', status: 'completed', priority: 'medium' },
      { id: '3', content: 'Task 3', status: 'in_progress', priority: 'low' },
    ];
    const ctx = createMockContext({ todos });
    const result = await todoReadTool.execute({}, ctx);
    
    expect(result.metadata?.count).toBe(3);
    expect(result.metadata?.pending).toBe(2); // pending + in_progress
    expect(result.metadata?.todos).toHaveLength(3);
    
    // Output should be JSON
    const parsed = JSON.parse(result.output);
    expect(parsed).toHaveLength(3);
  });
});

describe('todoWriteTool', () => {
  it('should have correct metadata', () => {
    expect(todoWriteTool.name).toBe('todowrite');
    expect(todoWriteTool.description).toBeDefined();
  });

  it('should return error when setTodos not available', async () => {
    const ctx = createMockContext({ hasTodoFunctions: false });
    const result = await todoWriteTool.execute({ todos: [] }, ctx);
    
    expect(result.output).toContain('not available');
    expect(result.metadata?.error).toBe(true);
  });

  it('should set empty todos array', async () => {
    const ctx = createMockContext({ todos: [{ id: '1', content: 'Old', status: 'pending', priority: 'high' }] });
    const result = await todoWriteTool.execute({ todos: [] }, ctx);
    
    expect(result.metadata?.count).toBe(0);
    expect(ctx.getTodos!()).toHaveLength(0);
  });

  it('should set new todos and return counts', async () => {
    const ctx = createMockContext();
    const newTodos: TodoItem[] = [
      { id: '1', content: 'Task 1', status: 'pending', priority: 'high' },
      { id: '2', content: 'Task 2', status: 'completed', priority: 'medium' },
      { id: '3', content: 'Task 3', status: 'in_progress', priority: 'low' },
    ];
    
    const result = await todoWriteTool.execute({ todos: newTodos }, ctx);
    
    expect(result.metadata?.count).toBe(3);
    // pending includes both 'pending' and 'in_progress' statuses (all non-completed)
    expect(result.metadata?.pending).toBe(2);
    expect(result.metadata?.completed).toBe(1);
    expect(result.metadata?.inProgress).toBe(1);
    expect(ctx.getTodos!()).toEqual(newTodos);
  });

  it('should replace existing todos', async () => {
    const existingTodos: TodoItem[] = [
      { id: '1', content: 'Old Task', status: 'pending', priority: 'high' },
    ];
    const ctx = createMockContext({ todos: existingTodos });
    
    const newTodos: TodoItem[] = [
      { id: '2', content: 'New Task', status: 'completed', priority: 'low' },
    ];
    
    await todoWriteTool.execute({ todos: newTodos }, ctx);
    
    const current = ctx.getTodos!();
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe('2');
    expect(current[0].content).toBe('New Task');
  });
});
