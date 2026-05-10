import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";

const DESCRIPTION = `Use this tool to read your todo list.

Returns the current list of todos for this session, including their status and priority.`;

export const todoReadTool = defineTool({
  name: "todoread",
  description: DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    if (!ctx.getTodos) {
      return {
        output: "Todo functionality not available in this context.",
        metadata: { error: true },
      };
    }

    const todos = ctx.getTodos();

    if (todos.length === 0) {
      return {
        output: "No todos in the current list.",
        metadata: { todos: [], count: 0 },
      };
    }

    const pending = todos.filter((t) => t.status !== "completed").length;

    return {
      output: JSON.stringify(todos, null, 2),
      metadata: {
        todos,
        count: todos.length,
        pending,
      },
    };
  },
});
