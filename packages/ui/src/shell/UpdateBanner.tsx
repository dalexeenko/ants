import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { usePlatform, type UpdateStatus } from '../platform/PlatformContext';
import { useTheme } from '../styles';
import { Text } from '../primitives/Text';

/**
 * Persistent banner shown at the top of the app when an update has been
 * downloaded and is ready to install. Sits between the title bar and the
 * main layout in AppShell.
 *
 * Only renders when `platform.update` is available (desktop) and an update
 * has been downloaded. Dismissed by the user or by clicking "Restart".
 */
export function UpdateBanner() {
  const platform = usePlatform();
  const { colors, palette } = useTheme();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!platform.update) return;

    // Get initial status
    platform.update.getStatus().then(setStatus).catch(() => {});

    // Subscribe to status changes
    const unsub = platform.update.onStatusChange((newStatus) => {
      setStatus(newStatus);
      // Reset dismissed state when a new update becomes available
      if (newStatus.state === 'downloaded') {
        setDismissed(false);
      }
    });

    return unsub;
  }, [platform.update]);

  // Only show when an update has been downloaded and user hasn't dismissed
  if (!status || status.state !== 'downloaded' || dismissed || !platform.update) {
    return null;
  }

  const version = status.info?.version;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: palette.primaryMuted,
          borderBottomColor: colors.border.light,
        },
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.message} color="inverse">
          A new version{version ? ` (v${version})` : ''} is ready to install.
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={() => platform.update!.installUpdate()}
            style={[styles.button, { backgroundColor: palette.primary }]}
          >
            <Text style={styles.buttonText} color="inverse">
              Restart to Update
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setDismissed(true)}
            style={styles.dismissButton}
          >
            <Text style={styles.dismissText} color="inverse">
              Later
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderBottomWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 4,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  dismissButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    opacity: 0.7,
  },
  dismissText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
