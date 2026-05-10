/**
 * Subagent module - manages subagent lifecycle and communication.
 */

export { SubagentManager } from "./manager.js";
export type { SubagentManagerOptions, AgentFactory } from "./manager.js";

export type {
  SubagentSpawnOptions,
  SubagentResult,
  SubagentInfo,
  SubagentStatus,
  SubagentUsage,
  SubagentManagerInterface,
} from "./types.js";

export { SharedState, MessageBus } from "./shared-state.js";
export type {
  SharedStateEntry,
  SharedStateEvents,
  BusMessage,
  MessageBusEvents,
} from "./shared-state.js";
