import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';
import { Modal } from '../primitives/Modal';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { ApiKeyInput } from './ApiKeyInput';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import { Divider } from '../primitives/Divider';
import type { AuthStatus, ApiKeyInfo, AgentBridge } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('AuthenticationSection');

// Helper to open URL in browser
const openURL = (url: string) => {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window?.open(url, '_blank');
  } else {
    // For React Native, dynamically import Linking
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Linking } = require('react-native');
    Linking.openURL(url);
  }
};

interface AuthenticationSectionProps {
  bridge: AgentBridge;
}

export function AuthenticationSection({ bridge }: AuthenticationSectionProps) {
  const { colors } = useTheme();
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  
  // OAuth flow state
  const [oauthIntroVisible, setOauthIntroVisible] = useState(false);
  const [oauthModalVisible, setOauthModalVisible] = useState(false);
  const [oauthVerifier, setOauthVerifier] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState('');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);

  useEffect(() => {
    loadAuthData();
  }, []);

  const loadAuthData = async () => {
    try {
      const [status, keys] = await Promise.all([
        bridge.getAuthStatus(),
        bridge.getApiKeys(),
      ]);
      setAuthStatus(status);
      setApiKeys(keys);
    } catch (e) {
      log.error('Failed to load auth data:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthStart = () => {
    // Show intro modal first
    setOauthIntroVisible(true);
  };

  const handleOAuthContinue = async () => {
    setOauthIntroVisible(false);
    try {
      // Get OAuth URL and verifier
      const { url, verifier } = await bridge.initiateOAuth('anthropic');
      setOauthVerifier(verifier);
      setOauthCode('');
      setOauthError(null);
      setOauthUrl(url);
      setOauthModalVisible(true);
      
      // Open the OAuth URL in browser
      openURL(url);
    } catch (e) {
      log.error('Failed to initiate OAuth:', e);
    }
  };

  const handleOAuthComplete = async () => {
    if (!oauthVerifier || !oauthCode.trim()) return;
    
    setOauthLoading(true);
    setOauthError(null);
    
    try {
      await bridge.completeOAuth('anthropic', oauthCode.trim(), oauthVerifier);
      setOauthModalVisible(false);
      setOauthVerifier(null);
      setOauthCode('');
      setOauthUrl(null);
      await loadAuthData();
    } catch (e) {
      log.error('Failed to complete OAuth:', e);
      setOauthError('Failed to authenticate. Please check the code and try again.');
    } finally {
      setOauthLoading(false);
    }
  };

  const handleOAuthCancel = () => {
    setOauthIntroVisible(false);
    setOauthModalVisible(false);
    setOauthVerifier(null);
    setOauthCode('');
    setOauthError(null);
    setOauthUrl(null);
  };

  const handleDisconnect = async () => {
    await bridge.disconnectOAuth('anthropic');
    await loadAuthData();
  };

  const handleSetApiKey = async (provider: string, key: string) => {
    await bridge.setApiKey(provider, key);
    await loadAuthData();
  };

  const handleDeleteApiKey = async (provider: string) => {
    await bridge.deleteApiKey(provider);
    await loadAuthData();
  };

  const getApiKeyStatus = (provider: string): boolean => {
    return apiKeys.find((k) => k.provider === provider)?.hasKey ?? false;
  };

  if (loading) {
    return (
      <SettingsSection title="Authentication" description="Configure API keys for AI providers">
        <View style={styles.loading}>
          <Text style={{ color: colors.text.muted }}>Loading...</Text>
        </View>
      </SettingsSection>
    );
  }

  const anthropicConnected = authStatus?.anthropic.authenticated ?? false;
  const anthropicMethod = authStatus?.anthropic.method;

  return (
    <SettingsSection title="Local Authentication" description="Configure API keys for the on-device AI agent">
      {/* Anthropic OAuth Section */}
      <SettingsRow
        title="Anthropic"
        description={
          anthropicConnected
            ? `Connected via ${anthropicMethod === 'oauth' ? 'OAuth' : 'API Key'}`
            : 'Not connected'
        }
        action={
          anthropicConnected ? (
            <Button size="sm" variant="ghost" onPress={handleDisconnect}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onPress={handleOAuthStart}>
              Sign In
            </Button>
          )
        }
      />

      <View style={[styles.dividerContainer, { backgroundColor: colors.bg.secondary }]}>
        <View style={styles.dividerLine}>
          <Divider />
        </View>
        <Text style={[styles.dividerText, { color: colors.text.muted }]}>
          Or use API keys
        </Text>
        <View style={styles.dividerLine}>
          <Divider />
        </View>
      </View>

      {/* API Keys */}
      <ApiKeyInput
        provider="anthropic"
        label="Anthropic API Key"
        hasKey={getApiKeyStatus('anthropic')}
        onSave={(key) => handleSetApiKey('anthropic', key)}
        onDelete={() => handleDeleteApiKey('anthropic')}
      />

      <ApiKeyInput
        provider="openai"
        label="OpenAI API Key"
        hasKey={getApiKeyStatus('openai')}
        onSave={(key) => handleSetApiKey('openai', key)}
        onDelete={() => handleDeleteApiKey('openai')}
      />

      <ApiKeyInput
        provider="google"
        label="Google AI API Key"
        hasKey={getApiKeyStatus('google')}
        onSave={(key) => handleSetApiKey('google', key)}
        onDelete={() => handleDeleteApiKey('google')}
      />

      <ApiKeyInput
        provider="openrouter"
        label="OpenRouter API Key"
        hasKey={getApiKeyStatus('openrouter')}
        onSave={(key) => handleSetApiKey('openrouter', key)}
        onDelete={() => handleDeleteApiKey('openrouter')}
      />

      <ApiKeyInput
        provider="groq"
        label="Groq API Key"
        hasKey={getApiKeyStatus('groq')}
        onSave={(key) => handleSetApiKey('groq', key)}
        onDelete={() => handleDeleteApiKey('groq')}
      />

      <ApiKeyInput
        provider="xai"
        label="xAI API Key"
        hasKey={getApiKeyStatus('xai')}
        onSave={(key) => handleSetApiKey('xai', key)}
        onDelete={() => handleDeleteApiKey('xai')}
      />

      {/* OAuth Intro Modal */}
      <Modal
        visible={oauthIntroVisible}
        onClose={handleOAuthCancel}
        title="Sign in with Anthropic"
      >
        <View style={styles.modalContent}>
          <Text style={[styles.modalDescription, { color: colors.text.secondary }]}>
            To use Claude in this app, you need an active Claude Pro or Max subscription.
          </Text>
          
          <Text style={[styles.modalDescription, { color: colors.text.secondary, marginTop: spacing[2] }]}>
            When you continue, you'll be directed to Anthropic's website to authorize access.
            After authorizing, you'll receive a code that you'll need to copy and paste back into this app.
          </Text>
          
          <View style={styles.modalActions}>
            <Button
              variant="ghost"
              onPress={handleOAuthCancel}
            >
              Cancel
            </Button>
            <Button
              onPress={handleOAuthContinue}
            >
              Continue
            </Button>
          </View>
        </View>
      </Modal>

      {/* OAuth Code Entry Modal */}
      <Modal
        visible={oauthModalVisible}
        onClose={handleOAuthCancel}
        title="Enter Authorization Code"
      >
        <View style={styles.modalContent}>
          <Text style={[styles.modalDescription, { color: colors.text.secondary }]}>
            A browser window has opened to Anthropic's authorization page.
            After authorizing, copy the code shown and paste it below.
          </Text>
          {oauthUrl && (
            <Pressable onPress={() => openURL(oauthUrl)}>
              <Text style={[styles.modalLink, { color: colors.primary }]}>
                Didn't open? Click here to authorize.
              </Text>
            </Pressable>
          )}
          
          <View style={styles.inputContainer}>
            <Input
              value={oauthCode}
              onChange={setOauthCode}
              placeholder="Paste authorization code here"
              label="Authorization Code"
              error={oauthError || undefined}
            />
          </View>
          
          <View style={styles.modalActions}>
            <Button
              variant="ghost"
              onPress={handleOAuthCancel}
              disabled={oauthLoading}
            >
              Cancel
            </Button>
            <Button
              onPress={handleOAuthComplete}
              disabled={!oauthCode.trim() || oauthLoading}
            >
              {oauthLoading ? 'Signing in...' : 'Complete Sign In'}
            </Button>
          </View>
        </View>
      </Modal>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: spacing[4],
    alignItems: 'center',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  dividerLine: {
    flex: 1,
  },
  dividerText: {
    fontSize: 12,
    paddingHorizontal: spacing[3],
  },
  modalContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  modalDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  modalLink: {
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  inputContainer: {
    marginTop: spacing[2],
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    marginTop: spacing[2],
  },
});
