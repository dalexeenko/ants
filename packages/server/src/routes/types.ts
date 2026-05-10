import type { Message, AgentEvent, PermissionResponse, ToolResult } from "@openmgr/agent-core";
import type { SessionManager, ToolCallData, ToolResultData, MessageRow } from "@openmgr/agent-storage";
import type { ServerAgent, ServerState } from "../index.js";

/**
 * Session tracking state.
 */
export interface SessionState {
  isActive: boolean;
  aborted?: boolean;  // Set to true when session is being aborted
  agent?: ServerAgent;  // Per-session agent instance
  mode?: 'plan' | 'build';  // Agent mode for this session
}

/**
 * Shared context passed to each route creator.
 * Contains the server state and internal maps/helpers.
 */
export interface RouteContext {
  state: ServerState;
  sessionStates: Map<string, SessionState>;
  sessionLastActivity: Map<string, number>;
  permissionResolvers: Map<string, (response: PermissionResponse) => void>;
  getSessionAgent: (sessionId: string) => Promise<ServerAgent>;
}

/**
 * Convert agent-core ToolResult[] to storage ToolResultData[].
 * Agent-core uses { id, name, result, isError } while storage uses { toolCallId, content, isError }.
 */
export function toStorageToolResults(results: ToolResult[] | undefined): ToolResultData[] | undefined {
  if (!results || results.length === 0) return undefined;
  return results.map(r => ({
    toolCallId: r.id,
    content: typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
    isError: r.isError,
    ...(r.metadata ? { metadata: r.metadata } : {}),
  }));
}

/**
 * Convert agent-core ToolCall[] to storage ToolCallData[].
 * Both use { id, name, arguments } so this is mostly a type assertion.
 */
export function toStorageToolCalls(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | undefined): ToolCallData[] | undefined {
  if (!calls || calls.length === 0) return undefined;
  return calls.map(tc => ({
    id: tc.id,
    name: tc.name,
    arguments: tc.arguments,
  }));
}

/**
 * Convert storage MessageRow[] to agent-core Message[].
 * This is used to load a session's messages into the agent before prompting,
 * ensuring each session has its own isolated message history.
 */
export function toAgentMessages(rows: MessageRow[]): Message[] {
  return rows.map(row => {
    const msg: Message = {
      id: row.id,
      role: row.role as "user" | "assistant",
      content: row.content,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt),
    };
    if (row.toolCalls && Array.isArray(row.toolCalls) && row.toolCalls.length > 0) {
      msg.toolCalls = row.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }));
    }
    if (row.toolResults && Array.isArray(row.toolResults) && row.toolResults.length > 0) {
      msg.toolResults = row.toolResults.map(tr => ({
        id: tr.toolCallId,
        name: "", // Storage doesn't store tool name on results
        result: tr.content,
        isError: tr.isError,
        ...(tr.metadata ? { metadata: tr.metadata } : {}),
      }));
    }
    return msg;
  });
}
