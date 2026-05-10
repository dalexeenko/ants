import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Badge } from '../primitives/Badge';
import { Spinner } from '../primitives/Spinner';
import { SettingsSection } from './SettingsSection';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { AgentBridge, Channel, RemoteServerConfig } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ChannelsSection');

// Channel type display info
const CHANNEL_TYPE_INFO: Record<string, { label: string; icon: string }> = {
  slack: { label: 'Slack', icon: '#' },
  discord: { label: 'Discord', icon: '#' },
  twitter: { label: 'Twitter', icon: '@' },
  reddit: { label: 'Reddit', icon: 'r/' },
  telegram: { label: 'Telegram', icon: '@' },
};

interface ChannelsSectionProps {
  bridge: AgentBridge;
  serverId: string;
  serverName: string;
  onChannelPress: (channel: Channel) => void;
}

export function ChannelsSection({ bridge, serverId, serverName, onChannelPress }: ChannelsSectionProps) {
  const { colors } = useTheme();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadChannels();
  }, [serverId]);

  const loadChannels = async () => {
    setLoading(true);
    setError(null);
    try {
      const channelList = await bridge.listChannels(serverId);
      setChannels(channelList);
    } catch (e) {
      log.error('Failed to load channels:', e);
      setError(e instanceof Error ? e.message : 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SettingsSection
        title="Channels"
        description={`Messaging integrations for ${serverName}`}
      >
        <View style={[styles.loading, { backgroundColor: colors.bg.secondary }]}>
          <Spinner size="small" />
          <Text style={{ color: colors.text.muted, marginLeft: spacing[2] }}>Loading channels...</Text>
        </View>
      </SettingsSection>
    );
  }

  if (error) {
    return (
      <SettingsSection
        title="Channels"
        description={`Messaging integrations for ${serverName}`}
      >
        <View style={[styles.error, { backgroundColor: colors.bg.secondary }]}>
          <Text style={{ color: colors.error }}>{error}</Text>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Channels"
      description={`Messaging integrations for ${serverName}`}
    >
      {channels.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.bg.secondary }]}>
          <Text style={{ color: colors.text.muted }}>No channels configured on this server</Text>
        </View>
      ) : (
        channels.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            onPress={() => onChannelPress(channel)}
          />
        ))
      )}
    </SettingsSection>
  );
}

// ============ Channel Row ============

interface ChannelRowProps {
  channel: Channel;
  onPress: () => void;
}

function ChannelRow({ channel, onPress }: ChannelRowProps) {
  const { colors } = useTheme();
  const typeInfo = CHANNEL_TYPE_INFO[channel.type] || { label: channel.type, icon: '?' };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.channelRow,
        { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={styles.channelInfo}>
        <View style={styles.channelHeader}>
          <View style={[styles.channelIcon, { backgroundColor: colors.bg.tertiary }]}>
            <Text style={{ color: colors.text.secondary, fontWeight: '600' }}>
              {typeInfo.icon}
            </Text>
          </View>
          <View style={styles.channelName}>
            <Text style={[styles.nameText, { color: colors.text.primary }]}>
              {channel.name}
            </Text>
            <Text style={[styles.typeText, { color: colors.text.muted }]}>
              {typeInfo.label}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.channelStatus}>
        <Badge
          variant={channel.enabled ? 'success' : 'secondary'}
          size="sm"
        >
          {channel.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
        <Text style={[styles.chevron, { color: colors.text.muted }]}>{'>'}</Text>
      </View>
    </Pressable>
  );
}

// ============ Standalone Channels List (for ServerSettingsScreen) ============

interface ChannelsListProps {
  bridge: AgentBridge;
  server: RemoteServerConfig;
  onChannelPress: (channel: Channel) => void;
}

export function ChannelsList({ bridge, server, onChannelPress }: ChannelsListProps) {
  const { colors } = useTheme();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadChannels();
  }, [server.id]);

  const loadChannels = async () => {
    setLoading(true);
    setError(null);
    try {
      const channelList = await bridge.listChannels(server.id);
      setChannels(channelList);
    } catch (e) {
      log.error('Failed to load channels:', e);
      setError(e instanceof Error ? e.message : 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg.secondary }]}>
        <Spinner size="small" />
        <Text style={{ color: colors.text.muted, marginLeft: spacing[2] }}>Loading channels...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.error, { backgroundColor: colors.bg.secondary }]}>
        <Text style={{ color: colors.error }}>{error}</Text>
      </View>
    );
  }

  if (channels.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.bg.secondary }]}>
        <Text style={{ color: colors.text.muted }}>No channels configured on this server</Text>
      </View>
    );
  }

  return (
    <View>
      {channels.map((channel) => (
        <ChannelRow
          key={channel.id}
          channel={channel}
          onPress={() => onChannelPress(channel)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flexDirection: 'row',
    padding: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    padding: spacing[4],
    alignItems: 'center',
  },
  error: {
    padding: spacing[4],
    alignItems: 'center',
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
  },
  channelInfo: {
    flex: 1,
    marginRight: spacing[3],
  },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  channelIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelName: {
    flex: 1,
  },
  nameText: {
    fontSize: 14,
    fontWeight: '500',
  },
  typeText: {
    fontSize: 12,
    marginTop: 2,
  },
  channelStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  chevron: {
    fontSize: 16,
    fontWeight: '600',
  },
});
