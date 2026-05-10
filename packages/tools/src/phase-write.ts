import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";

const DESCRIPTION = `Use this tool to manage future phases of work - larger scope items that will be broken down into tasks later.

## What Are Phases?

Phases represent future work that is NOT part of the current task but should be done eventually. They are:
- **Larger in scope** than individual tasks
- **Deferred** until current work is complete
- **Placeholders** that will be broken down into specific tasks when their time comes

## Phase vs Task

| Phases | Tasks (Todos) |
|--------|---------------|
| Future work, not current focus | Current work, immediate focus |
| Broad scope ("Add authentication system") | Specific actions ("Create login form component") |
| Will be broken down later | Already broken down and actionable |
| Managed with phasewrite/phaseread | Managed with todowrite/todoread |

## When to Use Phases

1. **User requests multi-phase project** - Break into phases, start with phase 1 tasks
2. **Scope creep during work** - Add future ideas as phases instead of expanding current scope  
3. **Dependency ordering** - Phase 2 depends on Phase 1 completion
4. **Planning ahead** - Capture future work without losing focus on current tasks

## Workflow

1. When starting a large project, create phases for each major milestone
2. Mark the first phase as "in_progress"
3. Break down the in_progress phase into specific tasks (todos)
4. Work through all tasks until complete
5. Mark phase as "completed", move to next phase
6. Repeat until all phases are done

## Phase States

- **pending**: Phase not yet started (future work)
- **in_progress**: Currently being worked on (only ONE at a time)
- **completed**: Phase finished successfully
- **cancelled**: Phase no longer needed

## Important

- Keep working through tasks AND phases until the entire project is complete
- When a phase is marked in_progress, immediately break it down into tasks
- Only have ONE phase in_progress at a time
- Complete all tasks for current phase before moving to the next`;

const PhaseItemSchema = z.object({
  id: z.string().describe("Unique identifier for the phase"),
  content: z.string().describe("Description of the phase - what this body of work accomplishes"),
  status: z
    .enum(["pending", "in_progress", "completed", "cancelled"])
    .describe("Current status of the phase"),
});

export const phaseWriteTool = defineTool({
  name: "phasewrite",
  description: DESCRIPTION,
  parameters: z.object({
    phases: z.array(PhaseItemSchema).describe("The updated phase list"),
  }),
  async execute(params, ctx) {
    if (!ctx.setPhases) {
      return {
        output: "Phase functionality not available in this context.",
        metadata: { error: true },
      };
    }

    ctx.setPhases(params.phases);

    const pending = params.phases.filter((p) => p.status === "pending").length;
    const completed = params.phases.filter((p) => p.status === "completed").length;
    const inProgress = params.phases.filter((p) => p.status === "in_progress").length;

    return {
      output: JSON.stringify(params.phases, null, 2),
      metadata: {
        phases: params.phases,
        count: params.phases.length,
        pending,
        completed,
        inProgress,
      },
    };
  },
});
