/**
 * CloudflareAccessSettings — rendered in the ServerSettings Connection section
 * when the server's authType is 'cloudflare-access'.
 *
 * Shows the current Client ID (partially masked) and allows editing
 * the Client ID and Client Secret.
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Input } from '../../primitives/Input';
import { Text } from '../../primitives/Text';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { spacing } from '../../styles/tokens';
import type { AuthProviderSettingsProps } from '../types';

export function CloudflareAccessSettings({
  authConfig,
  onAuthConfigChange,
}: AuthProviderSettingsProps) {
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState<string>((authConfig.clientId as string) || '');
  const [clientSecret, setClientSecret] = useState<string>('');

  const currentClientId = (authConfig.clientId as string) || '';
  const hasCredentials = !!currentClientId;

  const maskValue = (value: string): string => {
    if (!value || value.length <= 8) return value ? '********' : '';
    return value.slice(0, 4) + '****' + value.slice(-4);
  };

  const handleSave = () => {
    onAuthConfigChange({
      clientId,
      clientSecret: clientSecret || authConfig.clientSecret,
    });
    setEditing(false);
    setClientSecret('');
  };

  const handleCancel = () => {
    setClientId(currentClientId);
    setClientSecret('');
    setEditing(false);
  };

  if (editing) {
    return (
      <View style={styles.container}>
        <Text variant="heading" style={styles.heading}>Cloudflare Access</Text>
        <Text color="secondary" style={styles.description}>
          Update your Cloudflare Access Service Token credentials.
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
          placeholder="Leave blank to keep current secret"
          secureTextEntry
          style={styles.input}
        />
        <View style={styles.actions}>
          <Button size="sm" variant="ghost" onPress={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onPress={handleSave} disabled={!clientId}>
            Save
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text variant="heading" style={styles.heading}>Cloudflare Access</Text>
      <Card variant="outlined" padding="md">
        <View style={styles.row}>
          <View style={styles.info}>
            <Text weight="medium">Service Token</Text>
            <Text color={hasCredentials ? 'secondary' : 'muted'}>
              {hasCredentials
                ? `Client ID: ${maskValue(currentClientId)}`
                : 'No credentials configured'}
            </Text>
          </View>
          <Button size="sm" variant="ghost" onPress={() => setEditing(true)}>
            {hasCredentials ? 'Edit' : 'Configure'}
          </Button>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing[3],
  },
  heading: {
    marginBottom: spacing[1],
  },
  description: {
    fontSize: 13,
    marginBottom: spacing[3],
  },
  input: {
    marginBottom: spacing[3],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  info: {
    flex: 1,
  },
});
