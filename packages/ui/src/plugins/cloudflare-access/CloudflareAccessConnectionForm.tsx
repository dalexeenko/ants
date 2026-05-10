/**
 * CloudflareAccessConnectionForm — rendered in the Add Server modal
 * when the user selects "Cloudflare Access" as the auth type.
 *
 * Collects a Cloudflare Access Service Token's Client ID and Client Secret.
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Input } from '../../primitives/Input';
import { Text } from '../../primitives/Text';
import { spacing } from '../../styles/tokens';
import type { AuthProviderConnectionProps } from '../types';

export function CloudflareAccessConnectionForm({
  authConfig,
  onAuthConfigChange,
}: AuthProviderConnectionProps) {
  const [clientId, setClientId] = useState<string>((authConfig.clientId as string) || '');
  const [clientSecret, setClientSecret] = useState<string>((authConfig.clientSecret as string) || '');

  // Sync outward whenever either field changes
  useEffect(() => {
    onAuthConfigChange({ clientId, clientSecret });
  }, [clientId, clientSecret]);

  return (
    <View style={styles.container}>
      <Text color="secondary" style={styles.description}>
        Enter the Service Token credentials from your Cloudflare Access application.
      </Text>
      <Input
        label="Client ID"
        value={clientId}
        onChange={setClientId}
        placeholder="e.g. abc123.access"
        style={styles.input}
      />
      <Input
        label="Client Secret"
        value={clientSecret}
        onChange={setClientSecret}
        placeholder="Service token secret"
        secureTextEntry
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing[2],
  },
  description: {
    fontSize: 13,
    marginBottom: spacing[1],
  },
  input: {
    marginBottom: spacing[2],
  },
});
