import { useEffect } from 'react';
import { useDirectorStore, useUIStore, createLogger } from '../index';
import { usePlatform } from '../platform/PlatformContext';

const log = createLogger('DirectorEvents');

/**
 * Subscribes to Director agent events and dispatches them to the
 * Director Zustand store. Also handles director:navigate and
 * director:set-theme messages from the platform adapter.
 */
export function useDirectorEvents() {
  const platform = usePlatform();

  // Subscribe to Director agent events via the bridge
  useEffect(() => {
    if (!window.agentBridge) return;

    const unsubscribe = window.agentBridge.directorSubscribeToEvents((event) => {
      const store = useDirectorStore.getState();

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
          // Wait for 'done' event to clear processing
          break;

        case 'tool.start': {
          const newToolCall = {
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
            status: 'running' as const,
          };
          store.updateMessage(event.sessionId, event.messageId, (msg) => {
            const blocks = [...(msg.contentBlocks || [])];
            blocks.push({ type: 'tool_call' as const, toolCall: newToolCall });
            return {
              toolCalls: [...(msg.toolCalls || []), newToolCall],
              contentBlocks: blocks,
            };
          });
          break;
        }

        case 'tool.complete':
          store.updateMessage(event.sessionId, event.messageId, (msg) => {
            const updatedToolCalls = msg.toolCalls?.map((tc) =>
              tc.id === event.toolResult.id
                ? { ...tc, result: event.toolResult.result, status: 'complete' as const }
                : tc
            );
            const updatedBlocks = msg.contentBlocks?.map((block) => {
              if (block.type === 'tool_call' && block.toolCall.id === event.toolResult.id) {
                return {
                  ...block,
                  toolCall: { ...block.toolCall, result: event.toolResult.result, status: 'complete' as const },
                };
              }
              return block;
            });
            return {
              toolCalls: updatedToolCalls,
              contentBlocks: updatedBlocks,
            };
          });
          break;

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
          store.updateSession(event.sessionId, { title: event.title });
          break;

        case 'todos.updated':
          store.setTodos(event.sessionId, event.todos);
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
          useUIStore.getState().addToast({ message: event.error, type: 'error' });
          break;
      }
    });

    return unsubscribe;
  }, []);

  // Listen for director:navigate from platform adapter
  useEffect(() => {
    if (!platform.onDirectorNavigate) return;

    const unsubscribe = platform.onDirectorNavigate((target: string) => {
      log.info('Director navigate:', target);
      const uiStore = useUIStore.getState();
      switch (target) {
        case 'projects':
          uiStore.setActiveScreen('project');
          break;
        case 'settings':
          uiStore.setActiveScreen('settings');
          break;
        case 'agents':
          uiStore.setActiveScreen('agents');
          break;
        default:
          log.warn('Unknown Director navigate target:', target);
      }
    });

    return unsubscribe;
  }, [platform]);

  // Listen for director:set-theme from platform adapter
  useEffect(() => {
    if (!platform.onDirectorSetTheme) return;

    const unsubscribe = platform.onDirectorSetTheme((mode: string) => {
      log.info('Director set theme:', mode);
      const validModes = ['light', 'dark', 'system'];
      if (validModes.includes(mode)) {
        useUIStore.getState().setThemeMode(mode as 'light' | 'dark' | 'system');
      }
    });

    return unsubscribe;
  }, [platform]);
}
