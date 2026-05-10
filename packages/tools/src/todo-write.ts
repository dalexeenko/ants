import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";

const DESCRIPTION = `Use this tool to create and manage a structured task list for your current coding session.

This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.

## Tasks vs Phases

**Tasks (this tool)** are specific, actionable items for CURRENT work.
**Phases (phasewrite/phaseread)** are larger scope items for FUTURE work.

When working on a multi-phase project:
1. Use phases to track the overall milestones
2. Break the current phase into specific tasks here
3. Complete all tasks, then move to the next phase
4. Keep working until ALL phases are complete

## When to Use This Tool

Use this tool proactively in these scenarios:

1. **Complex multistep tasks** - When a task requires 3 or more distinct steps
2. **Non-trivial tasks** - Tasks that require careful planning or multiple operations
3. **User explicitly requests todo list** - When the user directly asks you to use the todo list
4. **User provides multiple tasks** - When users provide a list of things to be done
5. **After receiving new instructions** - Immediately capture user requirements as todos
6. **After completing a task** - Mark it complete and add any new follow-up tasks
7. **When starting a new phase** - Break the phase down into specific tasks

## Task States

- **pending**: Task not yet started
- **in_progress**: Currently working on (limit to ONE task at a time)
- **completed**: Task finished successfully
- **cancelled**: Task no longer needed

## Priority Levels

- **high**: Critical tasks that block other work
- **medium**: Important tasks that should be done soon
- **low**: Nice-to-have tasks that can wait

## Best Practices

1. Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
2. Only have ONE task in_progress at any time
3. Complete current tasks before starting new ones
4. Use clear, descriptive task names
5. When all tasks are done, check if there are more phases to work on`;

const TodoItemSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z.string().describe("Brief description of the task"),
  status: z
    .enum(["pending", "in_progress", "completed", "cancelled"])
    .describe("Current status of the task"),
  priority: z
    .enum(["high", "medium", "low"])
    .describe("Priority level of the task"),
});

export const todoWriteTool = defineTool({
  name: "todowrite",
  description: DESCRIPTION,
  parameters: z.object({
    todos: z.array(TodoItemSchema).describe("The updated todo list"),
  }),
  async execute(params, ctx) {
    if (!ctx.setTodos) {
      return {
        output: "Todo functionality not available in this context.",
        metadata: { error: true },
      };
    }

    ctx.setTodos(params.todos);

    const pending = params.todos.filter((t) => t.status !== "completed").length;
    const completed = params.todos.filter((t) => t.status === "completed").length;
    const inProgress = params.todos.filter((t) => t.status === "in_progress").length;

    return {
      output: JSON.stringify(params.todos, null, 2),
      metadata: {
        todos: params.todos,
        count: params.todos.length,
        pending,
        completed,
        inProgress,
      },
    };
  },
});
