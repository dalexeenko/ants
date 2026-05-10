import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { useDirectorStore } from '../store/directorStore';
import { useUIStore } from '../store/uiStore';
import { ChatPanel } from './ChatPanel';
import type { AgentBridge, AuthStatus, Message, PermissionResponse, QuestionResponsePayload } from '../agent/types';

export interface DirectorChatViewProps {
  bridge: AgentBridge;
  keyboardOffset?: number;
}

/**
 * Check if any provider has credentials configured.
 */
function hasAnyApiKey(status: AuthStatus): boolean {
  if (status.anthropic.authenticated) return true;
  if (status.openai?.hasApiKey) return true;
  if (status.google?.hasApiKey) return true;
  if (status.openrouter?.hasApiKey) return true;
  if (status.groq?.hasApiKey) return true;
  if (status.xai?.hasApiKey) return true;
  return false;
}

function ApiKeyRequiredBanner() {
  const { colors, palette } = useTheme();

  return (
    <View style={styles.welcome}>
      <View style={[styles.banner, { backgroundColor: palette.warningLight, borderColor: palette.warningDark + '40' }]}>
        <Icon name="lock" size={24} color={palette.warningDark} />
        <View style={styles.bannerContent}>
          <Text variant="heading" style={{ fontSize: 16 }}>
            API Key Required
          </Text>
          <Text color="secondary" style={{ fontSize: 13, lineHeight: 20 }}>
            The Director needs an API key to function. Add at least one LLM provider
            key (e.g. Anthropic, OpenAI) in Settings to get started.
          </Text>
          <Pressable
            style={[styles.settingsButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              useUIStore.getState().setActiveScreen('settings');
            }}
          >
            <Icon name="settings" size={14} color={colors.text.inverse} />
            <Text style={{ fontSize: 13, color: colors.text.inverse, fontWeight: '600' }}>
              Open Settings
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function DirectorWelcome({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const { colors } = useTheme();
  
  const suggestions = [
    { icon: 'folder-plus' as const, text: 'Set up a new project' },
    { icon: 'server' as const, text: 'Add a remote server' },
    { icon: 'key' as const, text: 'Configure API keys' },
    { icon: 'palette' as const, text: "What's my current setup?" },
  ];

  return (
    <View style={styles.welcome}>
      <Icon name="sparkles" size={40} color={colors.primary} />
      <Text variant="heading" style={styles.welcomeTitle}>
        How can I help?
      </Text>
      <Text color="muted" style={styles.welcomeSubtitle as any}>
        I can help you configure projects, servers, authentication, and more.
      </Text>
      <View style={styles.suggestions}>
        {suggestions.map((s, i) => (
          <Pressable
            key={i}
            style={[styles.suggestionChip, { backgroundColor: colors.bg.tertiary, borderColor: colors.border.light }]}
            onPress={() => onSuggestion(s.text)}
          >
            <Icon name={s.icon} size={14} color={colors.text.muted} />
            <Text style={{ fontSize: 13 }}>{s.text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function DirectorChatView({ bridge, keyboardOffset }: DirectorChatViewProps) {
  const { colors } = useTheme();
  const currentSessionId = useDirectorStore((s) => s.currentSessionId);
  const messages = useDirectorStore((s) => currentSessionId ? s.messagesBySession[currentSessionId] || [] : []);
  const processing = useDirectorStore((s) => currentSessionId ? s.processingBySession[currentSessionId] || false : false);
  const error = useDirectorStore((s) => currentSessionId ? s.errorBySession[currentSessionId] || null : null);
  const pendingPermission = useDirectorStore((s) => currentSessionId ? s.pendingPermissionsBySession[currentSessionId] || null : null);
  const pendingQuestion = useDirectorStore((s) => currentSessionId ? s.pendingQuestionsBySession[currentSessionId] || null : null);
  const setMessages = useDirectorStore((s) => s.setMessages);
  const addSession = useDirectorStore((s) => s.addSession);
  const setCurrentSession = useDirectorStore((s) => s.setCurrentSession);

  // Track whether the user has any API keys configured
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridge.getAuthStatus().then((status) => {
      if (!cancelled) {
        setHasApiKey(hasAnyApiKey(status));
      }
    }).catch(() => {
      if (!cancelled) {
        setHasApiKey(false);
      }
    });
    return () => { cancelled = true; };
  }, [bridge]);

  // Re-check auth status when returning from settings
  const activeScreen = useUIStore((s) => s.activeScreen);
  useEffect(() => {
    if (activeScreen !== 'director') return;
    // Re-check when we navigate back to the director screen
    bridge.getAuthStatus().then((status) => {
      setHasApiKey(hasAnyApiKey(status));
    }).catch(() => {});
  }, [activeScreen, bridge]);

  // Load messages when session changes
  useEffect(() => {
    if (!currentSessionId) return;
    bridge.directorGetMessages(currentSessionId).then((msgs) => {
      setMessages(currentSessionId, msgs);
    }).catch(() => {});
  }, [currentSessionId, bridge]);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (currentSessionId) return currentSessionId;
    try {
      const session = await bridge.directorCreateSession();
      addSession(session);
      setCurrentSession(session.id);
      return session.id;
    } catch {
      return null;
    }
  }, [currentSessionId, bridge, addSession, setCurrentSession]);

  const handleSend = useCallback(async (content: string) => {
    const sessionId = await ensureSession();
    if (!sessionId) return;

    // Optimistic user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    useDirectorStore.getState().addMessage(sessionId, userMessage);
    useDirectorStore.getState().setProcessing(sessionId, true);
    useDirectorStore.getState().setError(sessionId, null);

    try {
      await bridge.directorSendMessage(sessionId, content);
    } catch (err) {
      useDirectorStore.getState().setError(
        sessionId,
        err instanceof Error ? err.message : 'Failed to send message'
      );
    }
  }, [ensureSession, bridge]);

  const handleCancel = useCallback(() => {
    if (currentSessionId) {
      bridge.directorCancelMessage(currentSessionId).catch(() => {});
    }
  }, [currentSessionId, bridge]);

  const handlePermissionResponse = useCallback(async (response: PermissionResponse) => {
    if (!pendingPermission || !currentSessionId) return;
    try {
      await bridge.directorRespondToPermission(currentSessionId, pendingPermission.id, response);
      useDirectorStore.getState().setPendingPermission(currentSessionId, null);
    } catch {
      // ignore
    }
  }, [currentSessionId, pendingPermission, bridge]);

  const handleQuestionResponse = useCallback(async (response: QuestionResponsePayload) => {
    if (!pendingQuestion || !currentSessionId) return;
    try {
      await bridge.directorRespondToQuestion(currentSessionId, pendingQuestion.questionId, response);
      useDirectorStore.getState().setPendingQuestion(currentSessionId, null);
    } catch {
      // ignore
    }
  }, [currentSessionId, pendingQuestion, bridge]);

  const header = currentSessionId && messages.length > 0 ? (
    <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
      <Icon name="sparkles" size={14} color={colors.primary} />
      <Text variant="heading" style={{ fontSize: 14 }}>Director</Text>
    </View>
  ) : null;

  // Show API key required banner if no keys are configured
  const showApiKeyBanner = hasApiKey === false;

  const emptyComponent = showApiKeyBanner ? (
    <ApiKeyRequiredBanner />
  ) : (
    <DirectorWelcome onSuggestion={(text) => handleSend(text)} />
  );

  return (
    <ChatPanel
      messages={messages}
      isProcessing={processing}
      error={error}
      pendingPermission={pendingPermission}
      pendingQuestion={pendingQuestion}
      onSendMessage={handleSend}
      onCancelMessage={handleCancel}
      onPermissionResponse={handlePermissionResponse}
      onQuestionResponse={handleQuestionResponse}
      placeholder={showApiKeyBanner ? "Add an API key to use the Director..." : "Ask the Director..."}
      headerComponent={header}
      emptyComponent={emptyComponent}
      testID="openmgr-director-chat"
      inputDisabled={showApiKeyBanner}
      keyboardOffset={keyboardOffset}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  welcome: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  welcomeTitle: {
    fontSize: 24,
    marginTop: 8,
  },
  welcomeSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 400,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    maxWidth: 500,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    cursor: 'pointer',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: 480,
    width: '100%',
  },
  bannerContent: {
    flex: 1,
    gap: 8,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
    cursor: 'pointer',
  },
});
