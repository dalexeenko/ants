/**
 * Shared types and helpers for bridge modules.
 *
 * These are internal types used to wire the domain modules together.
 * External consumers should continue importing from '../types' and '../BridgeCore'.
 */

import type {
  Project,
  Session,
  Message,
  RemoteServerConfig,
  AgentEvent,
} from '../types';

import type {
  ManagedAgent,
  PlatformStorage,
  PlatformFilesystem,
  PlatformAgentFactory,
  PlatformSSEHandler,
  BridgeCoreConfig,
} from '../BridgeCore';

// Re-export for convenience inside modules
export type {
  ManagedAgent,
  PlatformStorage,
  PlatformFilesystem,
  PlatformAgentFactory,
  PlatformSSEHandler,
  BridgeCoreConfig,
};

/**
 * Shared mutable state that all bridge modules read/write.
 */
export interface BridgeState {
  /** All known projects (local + cached remote). */
  projects: Map<string, Project>;
  /** Local agents keyed by project ID. */
  localAgents: Map<string, ManagedAgent>;
  /** Registered remote servers. */
  remoteServers: Map<string, RemoteServerConfig>;
  /** Cached sessions from remote servers: projectId -> sessions. */
  remoteSessions: Map<string, Session[]>;
  /** Cached messages from remote sessions: sessionId -> messages. */
  remoteMessages: Map<string, Message[]>;
  /** Session-level model overrides: sessionId -> { provider, model }. */
  sessionModelOverrides: Map<string, { provider: string; model: string }>;
  /** Event subscribers for remote projects: projectId -> callbacks. */
  remoteEventSubscribers: Map<string, Set<(event: AgentEvent) => void>>;
  /** Active session per remote project (for permission/question routing). */
  remoteActiveSessionIds: Map<string, string>;
  /** Sessions that currently have an active SSE stream consuming events (prevents duplicate subscriptions). */
  activeSSEStreams: Set<string>;
}

/**
 * Shared helper functions passed to each module so they don't need to
 * re-implement common logic (ID generation, remote fetch, event emission, etc.).
 */
export interface BridgeHelpers {
  /** Generate a unique ID. */
  generateId(): string;

  /** Emit an event to the platform bridge. */
  emitEvent(projectId: string, event: AgentEvent): void;

  /** Emit an event for a remote project. */
  emitRemoteEvent(projectId: string, event: AgentEvent): void;

  /** Look up the remote server config for a project (null if not remote). */
  getRemoteServerForProject(projectId: string): RemoteServerConfig | null;

  /** Update a server's lastSeen timestamp and notify listeners. */
  updateServerLastSeen(serverId: string): void;

  /** Authenticated fetch to a remote server. */
  remoteFetch(server: RemoteServerConfig, path: string, options?: RequestInit): Promise<Response>;

  /** Convert session manager session to UI Session. */
  toUISession(s: { id: string; title: string | null; createdAt: Date; updatedAt: Date }): Session;

  /** Convert session manager message to UI Message. */
  toUIMessage(m: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    isCompactionSummary?: boolean | null;
    sequence?: number;
    createdAt: Date;
  }): Message;
}

/**
 * Dependencies bundle passed to every bridge module factory.
 */
export interface BridgeDeps {
  config: BridgeCoreConfig;
  state: BridgeState;
  helpers: BridgeHelpers;
}
