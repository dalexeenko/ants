import React, { useState, useRef, useEffect } from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { Text } from '../primitives/Text';
import { IconButton, Icon } from '../primitives/IconButton';
import { Badge } from '../primitives/Badge';
import { SessionList } from './SessionList';
import { SessionSearch } from './SessionSearch';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import { isTouchDevice } from '../styles/utils';
import type { Project, Session } from '../agent/types';

/** Minimum number of sessions to show search input */
const SEARCH_THRESHOLD = 5;

export interface ProjectSectionProps {
  project: Project;
  sessions: Session[];
  selectedSessionId?: string;
  expanded?: boolean;
  onToggleExpand: () => void;
  onSelectSession: (session: Session) => void;
  onDeleteSession?: (session: Session) => void;
  onNewSession: () => void;
  onNewWorktreeSession?: () => void;
  onProjectSettings?: (project: Project) => void;
  loading?: boolean;
}

export function ProjectSection({
  project,
  sessions,
  selectedSessionId,
  expanded,
  onToggleExpand,
  onSelectSession,
  onDeleteSession,
  onNewSession,
  onNewWorktreeSession,
  onProjectSettings,
  loading,
}: ProjectSectionProps) {
  const { colors } = useTheme();
  const [isHovered, setIsHovered] = useState(false);
  const headerRef = useRef<any>(null);

  // Use native DOM events on web to track hover properly with nested elements
  useEffect(() => {
    if (Platform.OS !== 'web' || !headerRef.current) return;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = headerRef.current as any;
    const handleMouseEnter = () => setIsHovered(true);
    const handleMouseLeave = () => setIsHovered(false);
    
    element.addEventListener?.('mouseenter', handleMouseEnter);
    element.addEventListener?.('mouseleave', handleMouseLeave);
    
    return () => {
      element.removeEventListener?.('mouseenter', handleMouseEnter);
      element.removeEventListener?.('mouseleave', handleMouseLeave);
    };
  }, []);

  const headerContent = (
    <Pressable
      ref={headerRef}
      style={[
        styles.header,
        { 
          borderBottomColor: colors.border.light,
          backgroundColor: isHovered ? colors.bg.secondary : 'transparent',
        },
      ]}
      onPress={onToggleExpand}
    >
      <View style={styles.headerLeft}>
        <Icon
          name={expanded ? 'chevronDown' : 'chevronRight'}
          size={12}
          color={colors.text.muted}
        />
        <Text weight="medium" style={styles.projectName} numberOfLines={1}>
          {project.name}
        </Text>
        {project.providerType === 'remote' && (
          <Badge variant="secondary" size="sm">
            Remote
          </Badge>
        )}
      </View>

      <View style={[styles.headerActions, { opacity: (isTouchDevice || isHovered) ? 1 : 0 }]}>
        {onProjectSettings && (
          <IconButton
            testID="ants-project-settings"
            icon="more"
            size="sm"
            variant="ghost"
            onPress={(e) => {
              e?.stopPropagation?.();
              onProjectSettings(project);
            }}
          />
        )}
        {onNewWorktreeSession && project.isGitRepo && project.worktreeEnabled && (
          <IconButton
            testID="ants-project-new-worktree-session"
            icon="gitBranch"
            size="sm"
            variant="ghost"
            onPress={(e) => {
              e?.stopPropagation?.();
              onNewWorktreeSession();
            }}
          />
        )}
        <IconButton
          testID="ants-project-new-session"
          icon="plus"
          size="sm"
          variant="ghost"
          onPress={(e) => {
            e?.stopPropagation?.();
            onNewSession();
          }}
        />
      </View>
    </Pressable>
  );

  return (
    <View testID={`ants-project-section-${project.id}`} style={styles.section}>
      {headerContent}

      {expanded ? (
        sessions.length >= SEARCH_THRESHOLD ? (
          <SessionSearch
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            onDeleteSession={onDeleteSession}
            loading={loading}
          />
        ) : (
          <SessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            onDeleteSession={onDeleteSession}
            loading={loading}
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    overflow: 'hidden',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  projectName: {
    flex: 1,
  },
});
