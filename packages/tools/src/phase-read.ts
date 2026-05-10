import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";

const DESCRIPTION = `Use this tool to read your phase list.

Returns the current list of phases for this session, including their status.

Phases represent future work that will be broken down into tasks when their time comes.
Use this to check project progress and determine what phase to work on next.`;

export const phaseReadTool = defineTool({
  name: "phaseread",
  description: DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    if (!ctx.getPhases) {
      return {
        output: "Phase functionality not available in this context.",
        metadata: { error: true },
      };
    }

    const phases = ctx.getPhases();

    if (phases.length === 0) {
      return {
        output: "No phases in the current list.",
        metadata: { phases: [], count: 0 },
      };
    }

    const pending = phases.filter((p) => p.status === "pending").length;
    const inProgress = phases.filter((p) => p.status === "in_progress").length;
    const completed = phases.filter((p) => p.status === "completed").length;

    return {
      output: JSON.stringify(phases, null, 2),
      metadata: {
        phases,
        count: phases.length,
        pending,
        inProgress,
        completed,
      },
    };
  },
});
