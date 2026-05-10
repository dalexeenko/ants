import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon, IconButton } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { FileEntry, AgentBridge } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('FileBrowser');

export interface FileBrowserProps {
  /** The agent bridge for file operations */
  bridge: AgentBridge;
  /** Current project ID */
  projectId: string;
  /** Called when a file is selected */
  onFileSelect?: (file: FileEntry) => void;
  /** Called when a file should be opened/viewed */
  onFileOpen?: (file: FileEntry) => void;
}

/**
 * File browser component for navigating project files.
 */
export function FileBrowser({
  bridge,
  projectId,
  onFileSelect,
  onFileOpen,
}: FileBrowserProps) {
  const { colors } = useTheme();
  const [currentPath] = useState('.');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['.']));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    try {
      setLoading(true);
      setError(null);
      const files = await bridge.readDirectory(projectId, path);
      setEntries(files);
    } catch (e) {
      log.error('Failed to load directory:', e);
      setError(e instanceof Error ? e.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, [bridge, projectId]);

  // Load root directory on mount
  useEffect(() => {
    loadDirectory('.');
  }, [loadDirectory]);

  const handleRefresh = useCallback(() => {
    loadDirectory(currentPath);
  }, [loadDirectory, currentPath]);

  const handleFileClick = useCallback((file: FileEntry) => {
    setSelectedPath(file.path);
    onFileSelect?.(file);
    
    if (file.isDirectory) {
      // Toggle directory expansion
      setExpandedDirs(prev => {
        const next = new Set(prev);
        if (next.has(file.path)) {
          next.delete(file.path);
        } else {
          next.add(file.path);
        }
        return next;
      });
    }
  }, [onFileSelect]);

  const handleFileDoubleClick = useCallback((file: FileEntry) => {
    if (!file.isDirectory) {
      onFileOpen?.(file);
    }
  }, [onFileOpen]);

  if (loading && entries.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg.secondary }]}>
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={colors.text.muted} />
          <Text color="muted" style={styles.loadingText}>Loading files...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg.secondary }]}>
        <View style={styles.error}>
          <Icon name="alertCircle" size={24} color={colors.text.muted} />
          <Text color="muted" style={styles.errorText}>{error}</Text>
          <Pressable onPress={handleRefresh} style={styles.retryButton}>
            <Text style={{ color: colors.primary }}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.secondary }]} testID="ants-file-browser">
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[1] }}>
          <Text variant="caption" weight="medium" style={styles.headerTitle}>
            FILES
          </Text>
          {/* Show worktree indicator if the working directory is inside a .worktrees folder */}
          {entries.length > 0 && entries[0]?.path?.includes('.worktrees/') && (
            <View style={[styles.worktreeBadge, { backgroundColor: colors.bg.elevated }]}>
              <Icon name="gitBranch" size={10} color={colors.text.muted} />
              <Text variant="caption" color="muted" style={{ fontSize: 10 }}>worktree</Text>
            </View>
          )}
        </View>
        <IconButton
          icon="refresh"
          size="sm"
          variant="ghost"
          onPress={handleRefresh}
        />
      </View>

      {/* File list */}
      <ScrollView style={styles.list}>
        {entries.length === 0 ? (
          <View style={styles.empty}>
            <Text color="muted" variant="caption">No files</Text>
          </View>
        ) : (
          entries.map((entry) => (
            <FileTreeItem
              key={entry.path}
              entry={entry}
              bridge={bridge}
              projectId={projectId}
              depth={0}
              expanded={expandedDirs.has(entry.path)}
              selected={selectedPath === entry.path}
              onPress={handleFileClick}
              onDoublePress={handleFileDoubleClick}
              expandedDirs={expandedDirs}
              setExpandedDirs={setExpandedDirs}
              selectedPath={selectedPath}
              setSelectedPath={setSelectedPath}
              onFileSelect={onFileSelect}
              onFileOpen={onFileOpen}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

interface FileTreeItemProps {
  entry: FileEntry;
  bridge: AgentBridge;
  projectId: string;
  depth: number;
  expanded: boolean;
  selected: boolean;
  onPress: (entry: FileEntry) => void;
  onDoublePress: (entry: FileEntry) => void;
  expandedDirs: Set<string>;
  setExpandedDirs: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedPath: string | null;
  setSelectedPath: React.Dispatch<React.SetStateAction<string | null>>;
  onFileSelect?: (file: FileEntry) => void;
  onFileOpen?: (file: FileEntry) => void;
}

function FileTreeItem({
  entry,
  bridge,
  projectId,
  depth,
  expanded,
  selected,
  onPress,
  onDoublePress,
  expandedDirs,
  setExpandedDirs,
  selectedPath,
  setSelectedPath,
  onFileSelect,
  onFileOpen,
}: FileTreeItemProps) {
  const { colors } = useTheme();
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Load children when expanded
  useEffect(() => {
    if (entry.isDirectory && expanded && children.length === 0) {
      setLoading(true);
      bridge.readDirectory(projectId, entry.path)
        .then(setChildren)
        .catch((e) => log.error('Failed to load children:', e))
        .finally(() => setLoading(false));
    }
  }, [entry, expanded, bridge, projectId, children.length]);

  const handlePress = useCallback(() => {
    setSelectedPath(entry.path);
    onFileSelect?.(entry);
    
    if (entry.isDirectory) {
      setExpandedDirs(prev => {
        const next = new Set(prev);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
        }
        return next;
      });
    } else if (Platform.OS !== 'web') {
      // On mobile, a single tap opens the file (no double-click available)
      onFileOpen?.(entry);
    }
  }, [entry, setSelectedPath, setExpandedDirs, onFileSelect, onFileOpen]);

  const handleDoublePress = useCallback(() => {
    if (!entry.isDirectory) {
      onFileOpen?.(entry);
    }
  }, [entry, onFileOpen]);

  const getFileIcon = (entry: FileEntry): string => {
    if (entry.isDirectory) {
      return expanded ? 'folderOpen' : 'folder';
    }
    
    const ext = entry.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
        return 'code';
      case 'json':
        return 'code';
      case 'md':
        return 'file';
      case 'git':
        return 'git';
      default:
        return 'file';
    }
  };

  return (
    <>
      <Pressable
        style={[
          styles.item,
          { 
            paddingLeft: spacing[3] + depth * 16,
            backgroundColor: selected 
              ? colors.bg.tertiary 
              : isHovered 
              ? colors.bg.secondary 
              : 'transparent',
          },
        ]}
        onPress={handlePress}
        onLongPress={Platform.OS === 'web' ? handleDoublePress : undefined}
        onHoverIn={() => setIsHovered(true)}
        onHoverOut={() => setIsHovered(false)}
      >
        {entry.isDirectory && (
          <Icon
            name={expanded ? 'chevronDown' : 'chevronRight'}
            size={12}
            color={colors.text.muted}
          />
        )}
        {!entry.isDirectory && <View style={{ width: 12 }} />}
        
        <Icon
          name={getFileIcon(entry)}
          size={14}
          color={entry.isDirectory ? colors.primary : colors.text.muted}
        />
        
        <Text 
          numberOfLines={1} 
          style={[styles.itemName, { color: colors.text.primary }]}
        >
          {entry.name}
        </Text>
      </Pressable>

      {/* Render children if expanded */}
      {entry.isDirectory && expanded && (
        <>
          {loading ? (
            <View style={[styles.loadingChildren, { paddingLeft: spacing[3] + (depth + 1) * 16 }]}>
              <ActivityIndicator size="small" color={colors.text.muted} />
            </View>
          ) : (
            children.map((child) => (
              <FileTreeItem
                key={child.path}
                entry={child}
                bridge={bridge}
                projectId={projectId}
                depth={depth + 1}
                expanded={expandedDirs.has(child.path)}
                selected={selectedPath === child.path}
                onPress={onPress}
                onDoublePress={onDoublePress}
                expandedDirs={expandedDirs}
                setExpandedDirs={setExpandedDirs}
                selectedPath={selectedPath}
                setSelectedPath={setSelectedPath}
                onFileSelect={onFileSelect}
                onFileOpen={onFileOpen}
              />
            ))
          )}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  headerTitle: {
    letterSpacing: 0.5,
  },
  list: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[1.5],
    paddingRight: spacing[3],
  },
  itemName: {
    flex: 1,
    fontSize: 13,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  loadingText: {
    marginTop: spacing[2],
  },
  loadingChildren: {
    paddingVertical: spacing[2],
  },
  error: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
    gap: spacing[2],
  },
  errorText: {
    textAlign: 'center' as const,
  },
  retryButton: {
    marginTop: spacing[2],
  },
  empty: {
    padding: spacing[4],
    alignItems: 'center',
  },
  worktreeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing[1],
    paddingVertical: 1,
    borderRadius: 4,
  },
});
