/**
 * Portable session manager exports for React Native.
 * 
 * This module re-exports the SessionManager without Node.js-specific dependencies.
 * Use this in React Native apps with @ants/agent-database-react-native.
 */

export {
  SessionManager,
  type SessionManagerOptions,
  type GenericAgentDatabase,
  type CreateSessionOptions,
  type CreateMessageOptions,
  type UpdateSessionOptions,
  type SearchSessionsOptions,
  type SearchMessagesOptions,
  type SearchSessionResult,
  type SearchMessageResult,
} from "./sessions.js";

// Re-export schema types from database-core (React Native compatible)
export {
  // Tables
  projects,
  remoteServers,
  sessions,
  messages,
  compactionHistory,
  // Types
  type ProjectRow,
  type ProjectInsert,
  type RemoteServerRow,
  type RemoteServerInsert,
  type SessionRow,
  type SessionInsert,
  type MessageRow,
  type MessageInsert,
  type CompactionHistoryRow,
  type CompactionHistoryInsert,
  type ToolCallData,
  type ToolResultData,
} from "@ants/agent-database-core";
