/**
 * Zod schemas for the SSE wire event protocol.
 *
 * These describe the shapes that arrive over the wire from the agent-server
 * (via the openmgr server proxy).  They are intentionally permissive — every
 * field beyond the event type is optional with sensible defaults, because
 * older agent versions may not send every field.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/** Nested `toolCall` object (used by tool.start and tool.permission.request). */
const toolCallWire = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

/** Nested `toolResult` object (used by tool.complete). */
const toolResultWire = z.object({
  id: z.string().optional(),
  result: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Question option shape. */
const questionOptionWire = z.object({
  label: z.string(),
  description: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Per-event wire schemas
// ---------------------------------------------------------------------------

export const messageStartWire = z.object({
  messageId: z.string().optional(),
});

export const messageDeltaWire = z.object({
  delta: z.string().optional(),
  text: z.string().optional(),
});

export const messageCompleteWire = z.object({
  content: z.string().optional(),
  message: z.string().optional(),
});

export const toolStartWire = z.object({
  toolCall: toolCallWire.optional(),
  // Flat fallback fields
  id: z.string().optional(),
  name: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const toolCompleteWire = z.object({
  toolResult: toolResultWire.optional(),
  // Flat fallback fields
  id: z.string().optional(),
  result: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const toolPermissionRequestWire = z.object({
  toolCall: toolCallWire.optional(),
  // Flat fallback fields
  id: z.string().optional(),
  name: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  messageId: z.string().optional(),
  // Subagent context (set when the permission request originates from a subagent)
  subagentSessionId: z.string().optional(),
  subagentDescription: z.string().optional(),
});

export const toolPermissionGrantedWire = z.object({
  toolName: z.string().optional(),
  messageId: z.string().optional(),
});

export const toolPermissionDeniedWire = z.object({
  toolName: z.string().optional(),
  messageId: z.string().optional(),
});

export const questionRequestWire = z.object({
  questionId: z.string().optional(),
  question: z.string().optional(),
  options: z.array(questionOptionWire).optional(),
  multiple: z.boolean().optional(),
});

export const subagentStartWire = z.object({
  sessionId: z.string().optional(),
  parentSessionId: z.string().optional(),
  description: z.string().optional(),
  async: z.boolean().optional(),
});

export const subagentCompleteWire = z.object({
  sessionId: z.string().optional(),
  parentSessionId: z.string().optional(),
  result: z.string().optional(),
});

export const subagentErrorWire = z.object({
  sessionId: z.string().optional(),
  parentSessionId: z.string().optional(),
  error: z.string().optional(),
});

export const sessionTitleUpdatedWire = z.object({
  sessionId: z.string().optional(),
  title: z.string().optional(),
});

export const errorWire = z.object({
  error: z.string().optional(),
});

/** Todo item shape (from agent core). */
const todoItemWire = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  priority: z.enum(['high', 'medium', 'low']),
});

/** Phase item shape (from agent core). */
const phaseItemWire = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

export const todosUpdatedWire = z.object({
  todos: z.array(todoItemWire).optional(),
});

export const phasesUpdatedWire = z.object({
  phases: z.array(phaseItemWire).optional(),
});

export const doneWire = z.object({
  message: z.string().optional(),
  hasOpenTodos: z.boolean().optional(),
  hasOpenPhases: z.boolean().optional(),
  todoCount: z.number().optional(),
  openTodoCount: z.number().optional(),
  phaseCount: z.number().optional(),
  openPhaseCount: z.number().optional(),
  todos: z.array(todoItemWire).optional(),
  phases: z.array(phaseItemWire).optional(),
});

/** Context usage shape (included in message.complete and compaction.complete). */
const contextUsageWire = z.object({
  currentTokens: z.number(),
  maxTokens: z.number(),
}).optional();

export const compactionStartWire = z.object({
  stats: z.object({
    currentTokens: z.number().optional(),
    threshold: z.number().optional(),
    messagesToCompact: z.number().optional(),
  }).optional(),
});

export const compactionDeltaWire = z.object({
  delta: z.string().optional(),
});

export const compactionCompleteWire = z.object({
  compactionId: z.string().optional(),
  stats: z.object({
    originalTokens: z.number().optional(),
    compactedTokens: z.number().optional(),
    messagesPruned: z.number().optional(),
    compressionRatio: z.number().optional(),
  }).optional(),
  contextUsage: contextUsageWire,
});

export const compactionErrorWire = z.object({
  error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Event type → schema mapping
// ---------------------------------------------------------------------------

export const sseEventSchemas = {
  'message.start': messageStartWire,
  'message.delta': messageDeltaWire,
  'message.complete': messageCompleteWire,
  'tool.start': toolStartWire,
  'tool.complete': toolCompleteWire,
  'tool.permission.request': toolPermissionRequestWire,
  'tool.permission.granted': toolPermissionGrantedWire,
  'tool.permission.denied': toolPermissionDeniedWire,
  'question.request': questionRequestWire,
  'subagent.start': subagentStartWire,
  'subagent.complete': subagentCompleteWire,
  'subagent.error': subagentErrorWire,
  'session.title.updated': sessionTitleUpdatedWire,
  'todos.updated': todosUpdatedWire,
  'phases.updated': phasesUpdatedWire,
  'compaction.start': compactionStartWire,
  'compaction.delta': compactionDeltaWire,
  'compaction.complete': compactionCompleteWire,
  'compaction.error': compactionErrorWire,
  'error': errorWire,
  'done': doneWire,
} as const;

export type SSEEventType = keyof typeof sseEventSchemas;

// ---------------------------------------------------------------------------
// Inferred TypeScript types for each wire event
// ---------------------------------------------------------------------------

export type MessageStartWire = z.infer<typeof messageStartWire>;
export type MessageDeltaWire = z.infer<typeof messageDeltaWire>;
export type MessageCompleteWire = z.infer<typeof messageCompleteWire>;
export type ToolStartWire = z.infer<typeof toolStartWire>;
export type ToolCompleteWire = z.infer<typeof toolCompleteWire>;
export type ToolPermissionRequestWire = z.infer<typeof toolPermissionRequestWire>;
export type ToolPermissionGrantedWire = z.infer<typeof toolPermissionGrantedWire>;
export type ToolPermissionDeniedWire = z.infer<typeof toolPermissionDeniedWire>;
export type QuestionRequestWire = z.infer<typeof questionRequestWire>;
export type SubagentStartWire = z.infer<typeof subagentStartWire>;
export type SubagentCompleteWire = z.infer<typeof subagentCompleteWire>;
export type SubagentErrorWire = z.infer<typeof subagentErrorWire>;
export type SessionTitleUpdatedWire = z.infer<typeof sessionTitleUpdatedWire>;
export type TodosUpdatedWire = z.infer<typeof todosUpdatedWire>;
export type PhasesUpdatedWire = z.infer<typeof phasesUpdatedWire>;
export type CompactionStartWire = z.infer<typeof compactionStartWire>;
export type CompactionDeltaWire = z.infer<typeof compactionDeltaWire>;
export type CompactionCompleteWire = z.infer<typeof compactionCompleteWire>;
export type CompactionErrorWire = z.infer<typeof compactionErrorWire>;
export type ErrorWire = z.infer<typeof errorWire>;
export type DoneWire = z.infer<typeof doneWire>;

// ---------------------------------------------------------------------------
// Parsing helper
// ---------------------------------------------------------------------------

/**
 * Attempt to parse an SSE wire event using the appropriate schema.
 *
 * For recognized event types, the data is validated and returned as a typed
 * object.  For unrecognised types, the raw data is returned unchanged so the
 * caller can still handle fallback logic (e.g. `data.message`).
 *
 * Validation is lenient (`.safeParse` + `.passthrough()` semantics):  unknown
 * extra fields are preserved, and parse failures fall through to the raw data
 * rather than throwing.
 */
export function parseSSEEventData<T extends SSEEventType>(
  eventType: T,
  data: Record<string, unknown>,
): z.infer<(typeof sseEventSchemas)[T]> {
  const schema = sseEventSchemas[eventType];
  if (!schema) return data as any;

  const result = schema.safeParse(data);
  if (result.success) return result.data as any;

  // Validation failed — return raw data so the caller degrades gracefully.
  return data as any;
}

/**
 * Check whether a string is a recognised SSE event type.
 */
export function isKnownSSEEventType(type: string): type is SSEEventType {
  return type in sseEventSchemas;
}
