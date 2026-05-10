import { useEffect } from 'react';
import { useUIStore, useProjectStore, useSessionStore, createLogger, type SubagentInfo } from '../index';

const log = createLogger('ProjectEvents');

/**
 * Subscribes to agent events for the current project and dispatches
 * them to the appropriate Zustand stores.
 */
export function useProjectEvents(currentProjectId: string | null) {
  useEffect(() => {
    if (!currentProjectId || !window.agentBridge) return;

    const unsubscribe = window.agentBridge.subscribeToProject(currentProjectId, (event) => {
      const store = useSessionStore.getState();

      switch (event.type) {
        case 'message.start':
          store.setProcessing(event.sessionId, true);
          store.setError(event.sessionId, null);
          store.setDone(event.sessionId, false);
          store.addMessage(event.sessionId, {
            id: event.messageId,
            role: 'assistant',
            content: '',
            contentBlocks: [],
            createdAt: Date.now(),
          });
          break;

        case 'message.delta':
          store.updateMessage(event.sessionId, event.messageId, (msg) => {
            const blocks = [...(msg.contentBlocks || [])];
            const lastBlock = blocks[blocks.length - 1];

            if (lastBlock && lastBlock.type === 'text') {
              blocks[blocks.length - 1] = { type: 'text', text: lastBlock.text + event.delta };
            } else {
              blocks.push({ type: 'text', text: event.delta });
            }

            return {
              content: msg.content + event.delta,
              contentBlocks: blocks,
            };
          });
          break;

        case 'message.complete':
          // Don't clear processing here — wait for 'done' event
          break;

        case 'tool.start': {
          const newToolCall = {
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
            status: 'running' as const,
            startedAt: Date.now(),
          };
          log.debug('tool.start:', event.toolCall.name, 'id:', event.toolCall.id, 'messageId:', event.messageId);
          store.updateMessage(event.sessionId, event.messageId, (msg) => {
            const blocks = [...(msg.contentBlocks || [])];
            blocks.push({ type: 'tool_call' as const, toolCall: newToolCall });
            log.debug('tool.start: message', msg.id, 'now has', blocks.length, 'contentBlocks,', (msg.toolCalls?.length || 0) + 1, 'toolCalls');
            return {
              toolCalls: [...(msg.toolCalls || []), newToolCall],
              contentBlocks: blocks,
            };
          });
          break;
        }

        case 'tool.complete': {
          log.debug('tool.complete:', event.toolResult.id, 'messageId:', event.messageId);
          const toolMetadata = event.toolResult.metadata;
          store.updateMessage(event.sessionId, event.messageId, (msg) => {
            const updatedToolCalls = msg.toolCalls?.map((tc) =>
              tc.id === event.toolResult.id
                ? { ...tc, result: event.toolResult.result, metadata: toolMetadata, status: 'complete' as const, completedAt: Date.now() }
                : tc
            );
            const updatedBlocks = (msg.contentBlocks ?? []).map((block) => {
              if (block.type === 'tool_call' && block.toolCall.id === event.toolResult.id) {
                return {
                  ...block,
                  toolCall: { ...block.toolCall, result: event.toolResult.result, metadata: toolMetadata, status: 'complete' as const, completedAt: Date.now() },
                };
              }
              return block;
            });

            // If tool result has image metadata, add an inline image block after the tool call
            const image = toolMetadata?.image as { dataUrl?: string; path?: string; width: number; height: number } | undefined;
            if (image) {
              // Resolve the image URL — during live streaming the storage plugin
              // may have already replaced the base64 dataUrl with a file path,
              // so we need to resolve it via the platform bridge.
              let resolvedUrl = image.dataUrl;
              if (!resolvedUrl && image.path && currentProjectId && window.agentBridge?.resolveScreenshotUrl) {
                resolvedUrl = window.agentBridge.resolveScreenshotUrl(currentProjectId, image.path);
              }
              if (resolvedUrl) {
                updatedBlocks.push({
                  type: 'image' as const,
                  dataUrl: resolvedUrl,
                  width: image.width,
                  height: image.height,
                  alt: String(event.toolResult.result ?? ''),
                });
              }
            }

            return {
              toolCalls: updatedToolCalls,
              contentBlocks: updatedBlocks,
            };
          });
          break;
        }

        case 'tool.permission.request':
          store.setPendingPermission(event.sessionId, event.toolCall);
          break;

        case 'tool.permission.granted':
        case 'tool.permission.denied':
          store.setPendingPermission(event.sessionId, null);
          break;

        case 'question.request':
          store.setPendingQuestion(event.sessionId, {
            questionId: event.questionId,
            question: event.question,
            options: event.options,
            multiple: event.multiple,
            allowFreeform: event.allowFreeform,
          });
          break;

        case 'session.title.updated':
          store.updateSession(currentProjectId, event.sessionId, { title: event.title });
          break;

        case 'subagent.start':
          store.addSubagent(event.parentSessionId, {
            sessionId: event.sessionId,
            parentSessionId: event.parentSessionId,
            description: event.description,
            status: 'running',
            startedAt: Date.now(),
            async: event.async,
          } as SubagentInfo);
          // Auto-open a tab for the subagent without switching focus
          useUIStore.getState().openSubagentTab(event.sessionId, event.description, false);
          break;

        case 'subagent.complete':
          store.updateSubagent(event.parentSessionId, event.sessionId, {
            status: 'completed',
            completedAt: Date.now(),
            result: event.result,
          });
          break;

        case 'subagent.error':
          store.updateSubagent(event.parentSessionId, event.sessionId, {
            status: 'failed',
            completedAt: Date.now(),
            error: event.error,
          });
          break;

        case 'todos.updated':
          store.setTodos(event.sessionId, event.todos);
          break;

        case 'phases.updated':
          store.setPhases(event.sessionId, event.phases);
          break;

        case 'done':
          store.setProcessing(event.sessionId, false);
          if (event.sessionId !== store.currentSessionId) {
            store.setDone(event.sessionId, true);
          }
          break;

        case 'error':
          if (event.sessionId) {
            store.setProcessing(event.sessionId, false);
            store.setError(event.sessionId, event.error);
          }
          break;

        case 'setup.start':
          useUIStore.getState().addToast({ 
            message: event.message, 
            type: 'info',
            id: `setup-${event.component}`,
            loading: true,
          });
          break;

        case 'setup.progress':
          useUIStore.getState().updateToast(`setup-${event.component}`, {
            message: event.progress !== undefined 
              ? `${event.message} (${Math.round(event.progress * 100)}%)`
              : event.message,
            loading: true,
          });
          break;

        case 'setup.complete':
          useUIStore.getState().removeToast(`setup-${event.component}`);
          useUIStore.getState().addToast({ 
            message: event.message, 
            type: 'success',
          });
          break;

        case 'setup.error':
          useUIStore.getState().removeToast(`setup-${event.component}`);
          useUIStore.getState().addToast({ 
            message: `Setup error: ${event.error}`, 
            type: 'error',
          });
          break;

        case 'browser.created':
          // Auto-open a browser tab when the agent creates a browser
          useUIStore.getState().openBrowserTab(
            (event as any).browserId,
            (event as any).url,
            true,
          );
          break;

        case 'browser.closed':
          // Auto-close the browser tab
          useUIStore.getState().closeBrowserTab((event as any).browserId);
          break;

        case 'browser.navigated':
          // Update the tab label with the new hostname
          if ((event as any).browserId && (event as any).url) {
            const tabId = `browser:${(event as any).browserId}`;
            const tabs = useUIStore.getState().middleTabs;
            const tab = tabs.find((t) => t.id === tabId);
            if (tab) {
              let label = 'Browser';
              try {
                label = new URL((event as any).url).hostname || 'Browser';
              } catch {
                // keep default
              }
              // Update tab data and label
              const updatedTabs = tabs.map((t) =>
                t.id === tabId
                  ? { ...t, label, data: { ...t.data, browserUrl: (event as any).url } }
                  : t,
              );
              useUIStore.setState({ middleTabs: updatedTabs });
            }
          }
          break;
      }
    });

    // Load sessions for the project (sync from remote server first if needed)
    const loadSessions = async () => {
      const project = useProjectStore.getState().projects.find(p => p.id === currentProjectId);
      if (project?.providerType === 'remote') {
        await window.agentBridge!.syncRemoteSessions(currentProjectId);
      }
      const sessions = await window.agentBridge!.listSessions(currentProjectId);
      useSessionStore.getState().setSessions(currentProjectId, sessions);
    };
    loadSessions().catch((e) => {
      log.error('Failed to load sessions:', e);
      useUIStore.getState().addToast({ 
        message: `Failed to load sessions: ${e instanceof Error ? e.message : 'Unknown error'}`, 
        type: 'error' 
      });
    });

    return unsubscribe;
  }, [currentProjectId]);
}
