import React, { useState, useMemo, useRef, useEffect } from 'react';
import { View, Pressable, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Text } from '../primitives/Text';
import { IconButton, Icon } from '../primitives/IconButton';
import { ContextMenu, type ContextMenuItem } from '../primitives/ContextMenu';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, colors as tokenColors } from '../styles/tokens';
import { isTouchDevice } from '../styles/utils';
import { useSessionStore } from '../store/sessionStore';
import type { Session } from '../agent/types';

export type SessionStatus = 'processing' | 'needsPermission' | 'needsAnswer' | 'error' | 'done' | 'idle';

/** Semantic color strings extracted from tokens for status indicators */
const STATUS_COLORS = {
  primary: tokenColors.primary,
  warning: tokenColors.warning,
  error: tokenColors.error,
  info: tokenColors.info,
} as const;

/**
 * Derives the display status for a session from the store's per-session state maps.
 * Priority: needsPermission > needsAnswer > error > processing > done > idle
 */
export function getSessionStatus(
  sessionId: string,
  processingBySession: Record<string, boolean>,
  pendingPermissionsBySession: Record<string, unknown>,
  pendingQuestionsBySession: Record<string, unknown>,
  errorBySession: Record<string, string | null>,
  doneBySession: Record<string, boolean>,
): SessionStatus {
  if (pendingPermissionsBySession[sessionId]) return 'needsPermission';
  if (pendingQuestionsBySession[sessionId]) return 'needsAnswer';
  if (errorBySession[sessionId]) return 'error';
  if (processingBySession[sessionId]) return 'processing';
  if (doneBySession[sessionId]) return 'done';
  return 'idle';
}

const STATUS_CONFIG: Record<SessionStatus, { icon: string; color: string | null }> = {
  processing: { icon: 'loader', color: STATUS_COLORS.primary },
  needsPermission: { icon: 'shield', color: STATUS_COLORS.warning },
  needsAnswer: { icon: 'question', color: STATUS_COLORS.warning },
  error: { icon: 'xCircle', color: STATUS_COLORS.error },
  done: { icon: 'checkCircle', color: STATUS_COLORS.info },
  idle: { icon: 'message', color: null }, // uses theme muted color
};

export interface SessionListItemProps {
  session: Session;
  selected?: boolean;
  onPress: () => void;
  onDelete?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
}



/**
 * Icon wrapper that pulses opacity to draw attention to states needing interaction.
 */
function PulsingIcon({ name, size, color }: { name: string; size: number; color: string }) {
  const [dim, setDim] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setDim((prev) => !prev);
    }, 800);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={{ opacity: dim ? 0.3 : 1 }}>
      <Icon name={name} size={size} color={color} />
    </View>
  );
}

export function SessionListItem({
  session,
  selected,
  onPress,
  onDelete,
  onRename,
  onDuplicate,
}: SessionListItemProps) {
  const { colors } = useTheme();
  const [isHovered, setIsHovered] = useState(false);
  const itemRef = useRef<any>(null);

  // Read per-session status directly from the store
  const status = useSessionStore((state) =>
    getSessionStatus(
      session.id,
      state.processingBySession,
      state.pendingPermissionsBySession,
      state.pendingQuestionsBySession,
      state.errorBySession,
      state.doneBySession,
    )
  );

  // Use native DOM events on web to track hover properly with nested elements
  useEffect(() => {
    if (Platform.OS !== 'web' || !itemRef.current) return;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = itemRef.current as any;
    const handleMouseEnter = () => setIsHovered(true);
    const handleMouseLeave = () => setIsHovered(false);
    
    element.addEventListener?.('mouseenter', handleMouseEnter);
    element.addEventListener?.('mouseleave', handleMouseLeave);
    
    return () => {
      element.removeEventListener?.('mouseenter', handleMouseEnter);
      element.removeEventListener?.('mouseleave', handleMouseLeave);
    };
  }, []);

  // Build context menu items based on available handlers
  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [];
    
    if (onRename) {
      items.push({
        id: 'rename',
        label: 'Rename',
        icon: 'edit',
        onPress: onRename,
      });
    }
    
    if (onDuplicate) {
      items.push({
        id: 'duplicate',
        label: 'Duplicate',
        icon: 'copy',
        onPress: onDuplicate,
      });
    }
    
    if (onDelete) {
      items.push({
        id: 'delete',
        label: 'Delete',
        icon: 'trash',
        destructive: true,
        onPress: onDelete,
      });
    }
    
    return items;
  }, [onRename, onDuplicate, onDelete]);

  const hasContextMenu = contextMenuItems.length > 0;

  // Resolve icon and color for the current status
  const config = STATUS_CONFIG[status];
  const iconColor = config.color ?? colors.text.muted;

  const needsAttention = status === 'needsPermission' || status === 'needsAnswer';
  const statusIcon = status === 'processing' ? (
    <ActivityIndicator size="small" color={iconColor} style={styles.spinner} />
  ) : needsAttention ? (
    <PulsingIcon name={config.icon} size={14} color={iconColor} />
  ) : (
    <Icon name={config.icon} size={14} color={iconColor} />
  );

  const content = (
    <Pressable
      testID={`openmgr-session-item-${session.id}`}
      ref={itemRef}
      style={[
        styles.container,
        {
          backgroundColor: selected
            ? colors.bg.tertiary
            : isHovered
            ? colors.bg.secondary
            : 'transparent',
        },
      ]}
      onPress={onPress}
    >
      <View style={styles.content}>
        {statusIcon}
        <View style={styles.textContainer}>
          <Text numberOfLines={1} style={styles.title}>
            {session.title || 'Untitled Session'}
          </Text>
          <Text variant="caption" color="muted" numberOfLines={1}>
            {formatRelativeTime(session.updatedAt)}
          </Text>
        </View>
      </View>

      {onDelete ? (
        <View style={{ opacity: (isTouchDevice || isHovered) ? 1 : 0 }}>
          <IconButton
            icon="trash"
            size="sm"
            variant="ghost"
            onPress={(e) => {
              e?.stopPropagation?.();
              onDelete();
            }}
          />
        </View>
      ) : null}
    </Pressable>
  );

  if (hasContextMenu) {
    return (
      <ContextMenu items={contextMenuItems}>
        {content}
      </ContextMenu>
    );
  }

  return content;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    marginHorizontal: spacing[2],
    marginVertical: spacing[0.5],
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    overflow: 'hidden',
  },
  textContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  title: {
    marginBottom: spacing[0.5],
  },
  spinner: {
    width: 14,
    height: 14,
    transform: [{ scale: 0.7 }],
  },
});
