import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";
import { getDirectorContext } from "../context.js";

export const listSessionsTool = defineTool({
  name: "director_list_sessions",
  description:
    "List sessions for a specific project. Shows session titles, creation dates, and message counts. Use director_list_projects first to get a project ID.",
  parameters: z.object({
    projectId: z.string().describe("ID of the project to list sessions for"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      const sessions = await director.listSessions(params.projectId);
      if (sessions.length === 0) {
        return {
          output: "No sessions found for this project.",
        };
      }

      const formatted = sessions.map((s) => ({
        id: s.id,
        title: s.title || "Untitled",
        createdAt: new Date(s.createdAt).toLocaleString(),
        messageCount: s.messageCount ?? "unknown",
      }));

      return {
        output: JSON.stringify(formatted, null, 2),
        metadata: { count: sessions.length },
      };
    } catch (err) {
      return {
        output: `Failed to list sessions: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const createSessionTool = defineTool({
  name: "director_create_session",
  description:
    "Create a new agent session in a project. Optionally provide a title for the session.",
  parameters: z.object({
    projectId: z.string().describe("ID of the project to create a session in"),
    title: z
      .string()
      .optional()
      .describe("Optional title for the new session"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      const session = await director.createSession(params.projectId, {
        title: params.title,
      });
      return {
        output: `Session created successfully (ID: ${session.id}${session.title ? `, title: "${session.title}"` : ""}).`,
        metadata: { sessionId: session.id, projectId: params.projectId },
      };
    } catch (err) {
      return {
        output: `Failed to create session: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const deleteSessionTool = defineTool({
  name: "director_delete_session",
  description:
    "Delete a session from a project. This permanently removes the session and all its messages. Use director_list_sessions first to see available sessions.",
  parameters: z.object({
    projectId: z.string().describe("ID of the project the session belongs to"),
    sessionId: z.string().describe("ID of the session to delete"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      await director.deleteSession(params.projectId, params.sessionId);
      return { output: "Session deleted successfully." };
    } catch (err) {
      return {
        output: `Failed to delete session: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const sessionTools = [
  listSessionsTool,
  createSessionTool,
  deleteSessionTool,
];
