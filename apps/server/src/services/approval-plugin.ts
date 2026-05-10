/**
 * Approval plugin — integrates the server's ApprovalManager with the agent's
 * tool execution pipeline. When a tool call matches an approval rule, the plugin
 * emits an SSE event and blocks execution until a human approves or denies.
 *
 * This module is used in two ways:
 * 1. As a standalone plugin (if the agent runs in-process with onBeforeToolExecute hooks)
 * 2. As a utility by the session-streaming route to check tool calls intercepted
 *    from the SSE proxy stream
 */

import type { ApprovalManager } from './approval-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('approval-plugin');

export interface ApprovalPluginOptions {
  approvalManager: ApprovalManager;
  projectId: string;
  sessionId?: string;
  /** Called when an approval is needed — used to emit SSE events */
  onApprovalNeeded?: (data: {
    requestId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    ruleName: string;
    action: string;
  }) => void;
  /** Called when an approval decision is made */
  onApprovalDecision?: (data: {
    requestId: string;
    decision: 'approved' | 'denied' | 'expired' | 'blocked';
  }) => void;
}

/**
 * Creates an agent plugin that checks tool calls against approval rules.
 *
 * The returned object has an `onBeforeToolExecute` hook compatible with the
 * agent plugin system. When a matching rule is found:
 *
 * - **block**: throws immediately, preventing execution.
 * - **dry_run**: throws with a dry-run explanation.
 * - **require_approval**: emits an SSE event via `onApprovalNeeded`, waits
 *   for a human decision via `approvalManager.waitForReview`, and throws if
 *   denied or expired.
 */
export function createApprovalPlugin(options: ApprovalPluginOptions) {
  const { approvalManager, projectId, sessionId, onApprovalNeeded, onApprovalDecision } = options;

  return {
    name: 'server-approval',
    version: '1.0.0',

    async onBeforeToolExecute(
      toolCall: { id: string; name: string; arguments: Record<string, unknown> },
      _ctx: unknown,
    ) {
      const result = approvalManager.checkToolCall(
        projectId,
        toolCall.name,
        toolCall.arguments || {},
        sessionId,
      );

      if (result.allowed) {
        return; // Tool is allowed, proceed
      }

      if (result.action === 'block') {
        log.info(`Tool "${toolCall.name}" blocked by rule "${result.rule?.name}"`);
        onApprovalDecision?.({
          requestId: '',
          decision: 'blocked',
        });
        throw new Error(
          `Tool "${toolCall.name}" is blocked by approval rule: ${result.rule?.name || 'unknown'}`,
        );
      }

      if (result.action === 'dry_run') {
        log.info(`Tool "${toolCall.name}" in dry-run mode by rule "${result.rule?.name}"`);
        throw new Error(
          `Tool "${toolCall.name}" is in dry-run mode (rule: ${result.rule?.name || 'unknown'}). Execution skipped.`,
        );
      }

      if (result.action === 'require_approval' && result.requestId) {
        log.info(`Tool "${toolCall.name}" requires approval (request: ${result.requestId})`);

        // Emit SSE event so the client knows approval is needed
        onApprovalNeeded?.({
          requestId: result.requestId,
          toolName: toolCall.name,
          toolArgs: toolCall.arguments || {},
          ruleName: result.rule?.name || 'unknown',
          action: 'require_approval',
        });

        // Wait for human review (30 minute timeout)
        const decision = await approvalManager.waitForReview(result.requestId);

        log.info(`Approval decision for "${toolCall.name}": ${decision}`);
        onApprovalDecision?.({
          requestId: result.requestId,
          decision,
        });

        if (decision === 'approved') {
          return; // Proceed with execution
        }

        // Denied or expired
        throw new Error(
          decision === 'denied'
            ? `Tool "${toolCall.name}" was denied by reviewer`
            : `Tool "${toolCall.name}" approval expired (30 minute timeout)`,
        );
      }
    },
  };
}
