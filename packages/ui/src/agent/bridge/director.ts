/**
 * Director agent bridge methods.
 *
 * Unlike other bridge modules, the Director operates independently from
 * project-scoped agents. The actual implementation is injected by the
 * platform layer (desktop/mobile) since the Director agent lives there.
 *
 * This module provides a default no-op implementation that platforms
 * override when creating the bridge.
 */

import type { AgentBridge } from '../types';

type DirectorMethods = Pick<
  AgentBridge,
  | 'directorListSessions'
  | 'directorCreateSession'
  | 'directorDeleteSession'
  | 'directorGetMessages'
  | 'directorGetMessagesPaginated'
  | 'directorSendMessage'
  | 'directorCancelMessage'
  | 'directorSubscribeToEvents'
  | 'directorRespondToPermission'
  | 'directorRespondToQuestion'
>;

/**
 * Create default (no-op) Director methods.
 *
 * Platforms override these after creating the bridge instance.
 * This ensures the AgentBridge interface is satisfied even before
 * the Director agent is initialized.
 */
export function createDirectorMethods(): DirectorMethods {
  const notReady = () => {
    throw new Error('Director agent not initialized');
  };

  return {
    directorListSessions: notReady,
    directorCreateSession: notReady,
    directorDeleteSession: notReady,
    directorGetMessages: notReady,
    directorGetMessagesPaginated: notReady,
    directorSendMessage: notReady,
    directorCancelMessage: notReady,
    directorSubscribeToEvents: () => () => {},
    directorRespondToPermission: notReady,
    directorRespondToQuestion: notReady,
  };
}
