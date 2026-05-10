import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { Text } from './Text';
import { Button } from './Button';
import { Icon } from './IconButton';
import { Modal } from './Modal';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import { createLogger } from '../utils/logger';

const log = createLogger('DirectoryPicker');

/**
 * Directory entry from the filesystem
 */
export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * Filesystem provider interface for browsing directories.
 * Different platforms implement this to provide filesystem access.
 */
export interface FilesystemProvider {
  /** List entries in a directory */
  listDirectory(path: string): Promise<DirectoryEntry[]>;
  /** Get the home directory or default starting path */
  getHomePath(): Promise<string>;
  /** Get parent directory path */
  getParentPath(path: string): string;
  /** Check if a path is the root */
  isRoot(path: string): boolean;
  /** Create a new directory (optional - if not provided, create folder button won't show) */
  createDirectory?(path: string, name: string): Promise<string>;
}

export interface DirectoryPickerProps {
  /** Whether the picker modal is visible */
  visible: boolean;
  /** Called when the modal is closed without selection */
  onClose: () => void;
  /** Called when a directory is selected */
  onSelect: (path: string) => void;
  /** The filesystem provider to use */
  provider: FilesystemProvider;
  /** Title of the picker modal */
  title?: string;
  /** Initial path to start browsing from */
  initialPath?: string;
  /** Whether to show hidden files/directories */
  showHidden?: boolean;
}

export function DirectoryPicker({
  visible,
  onClose,
  onSelect,
  provider,
  title = 'Select Directory',
  initialPath,
  showHidden = false,
}: DirectoryPickerProps) {
  const { colors } = useTheme();
  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // New folder creation state
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Load initial path when modal opens
  useEffect(() => {
    if (visible) {
      loadInitialPath();
      // Reset new folder state when modal opens
      setShowNewFolderInput(false);
      setNewFolderName('');
    }
  }, [visible]);

  const loadInitialPath = async () => {
    setLoading(true);
    setError(null);
    try {
      const startPath = initialPath || (await provider.getHomePath());
      setCurrentPath(startPath);
      await loadDirectory(startPath);
    } catch (err) {
      setError('Failed to load initial directory');
      log.error('Failed to load initial path', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDirectory = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const items = await provider.listDirectory(path);
        // Filter to only directories and optionally hide hidden files
        let dirs = items.filter((item) => item.isDirectory);
        if (!showHidden) {
          dirs = dirs.filter((item) => !item.name.startsWith('.'));
        }
        // Sort alphabetically
        dirs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        
        // Deduplicate by path to prevent React key errors
        const seenPaths = new Set<string>();
        const uniqueDirs = dirs.filter((dir) => {
          if (seenPaths.has(dir.path)) {
            log.warn('Duplicate path filtered out:', dir.path);
            return false;
          }
          seenPaths.add(dir.path);
          return true;
        });
        
        setEntries(uniqueDirs);
        setCurrentPath(path);
      } catch (err) {
        setError('Failed to load directory');
        log.error('Failed to load directory', err);
      } finally {
        setLoading(false);
      }
    },
    [provider, showHidden]
  );

  const handleNavigateUp = useCallback(() => {
    if (!provider.isRoot(currentPath)) {
      const parentPath = provider.getParentPath(currentPath);
      loadDirectory(parentPath);
    }
  }, [currentPath, provider, loadDirectory]);

  const handleSelectEntry = useCallback(
    (entry: DirectoryEntry) => {
      loadDirectory(entry.path);
    },
    [loadDirectory]
  );

  const handleConfirm = useCallback(() => {
    onSelect(currentPath);
  }, [currentPath, onSelect]);

  const handleCreateFolder = useCallback(async () => {
    if (!provider.createDirectory || !newFolderName.trim()) return;
    
    setCreatingFolder(true);
    try {
      const newPath = await provider.createDirectory(currentPath, newFolderName.trim());
      // Navigate to the new directory
      await loadDirectory(newPath);
      setShowNewFolderInput(false);
      setNewFolderName('');
    } catch (err) {
      log.error('Failed to create folder', err);
      setError(`Failed to create folder: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setCreatingFolder(false);
    }
  }, [provider, currentPath, newFolderName, loadDirectory]);

  const handleCancelNewFolder = useCallback(() => {
    setShowNewFolderInput(false);
    setNewFolderName('');
  }, []);

  // Get display name for current path
  const getPathDisplay = (path: string): string => {
    if (!path) return '';
    // Split and take last few segments for readability
    const segments = path.split('/').filter(Boolean);
    if (segments.length <= 3) {
      return '/' + segments.join('/');
    }
    return '.../' + segments.slice(-2).join('/');
  };

  // Check if folder creation is supported
  const canCreateFolder = !!provider.createDirectory;

  const footer = (
    <>
      <Button variant="ghost" onPress={onClose}>
        Cancel
      </Button>
      <Button variant="primary" onPress={handleConfirm}>
        Select
      </Button>
    </>
  );

  return (
    <Modal visible={visible} onClose={onClose} title={title} footer={footer}>
      {/* Current path display with navigation and new folder button */}
      <View style={[styles.pathBar, { backgroundColor: colors.bg.secondary }]}>
        <Pressable
          onPress={handleNavigateUp}
          disabled={provider.isRoot(currentPath)}
          style={[
            styles.upButton,
            provider.isRoot(currentPath) && styles.upButtonDisabled,
          ]}
        >
          <Icon
            name="chevron-left"
            size={18}
            color={provider.isRoot(currentPath) ? colors.text.muted : colors.text.primary}
          />
        </Pressable>
        <Text variant="caption" color="secondary" numberOfLines={1} style={styles.pathText}>
          {currentPath || '/'}
        </Text>
        {canCreateFolder && !showNewFolderInput && (
          <Pressable
            onPress={() => setShowNewFolderInput(true)}
            style={styles.newFolderButton}
          >
            <Icon name="plus" size={16} color={colors.primary} />
          </Pressable>
        )}
      </View>

      {/* New folder input */}
      {showNewFolderInput && (
        <View style={[styles.newFolderContainer, { backgroundColor: colors.bg.tertiary }]}>
          <Icon name="folder" size={18} color={colors.primary} />
          <TextInput
            style={[
              styles.newFolderInput,
              {
                color: colors.text.primary,
                backgroundColor: colors.bg.secondary,
                borderColor: colors.border.light,
              },
            ]}
            placeholder="New folder name"
            placeholderTextColor={colors.text.muted}
            value={newFolderName}
            onChangeText={setNewFolderName}
            autoFocus
            onSubmitEditing={handleCreateFolder}
          />
          <Button
            variant="ghost"
            size="sm"
            onPress={handleCancelNewFolder}
            disabled={creatingFolder}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onPress={handleCreateFolder}
            disabled={!newFolderName.trim() || creatingFolder}
          >
            {creatingFolder ? 'Creating...' : 'Create'}
          </Button>
        </View>
      )}

      {/* Loading state */}
      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {/* Error state */}
      {error && !loading && (
        <View style={styles.centered}>
          <Text color="error">{error}</Text>
          <Button variant="ghost" onPress={loadInitialPath} style={styles.retryButton}>
            Retry
          </Button>
        </View>
      )}

      {/* Directory list */}
      {!loading && !error && (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {entries.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="folder" size={32} color={colors.text.muted} />
              <Text color="muted" style={styles.emptyText}>
                No subdirectories
              </Text>
              {canCreateFolder && (
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setShowNewFolderInput(true)}
                  style={styles.createFirstButton}
                >
                  Create a folder
                </Button>
              )}
            </View>
          ) : (
            entries.map((entry, index) => (
              <Pressable
                key={`${entry.path}-${index}`}
                style={({ pressed }) => [
                  styles.entry,
                  { borderBottomColor: colors.border.light },
                  pressed && { backgroundColor: colors.bg.secondary },
                ]}
                onPress={() => handleSelectEntry(entry)}
              >
                <Icon name="folder" size={18} color={colors.primary} />
                <Text style={styles.entryName} numberOfLines={1}>
                  {entry.name}
                </Text>
                <Icon name="chevron-right" size={16} color={colors.text.muted} />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      {/* Selected path info */}
      <View style={[styles.selectedPath, { backgroundColor: colors.bg.tertiary }]}>
        <Text variant="caption" color="muted">
          Selected:
        </Text>
        <Text variant="caption" numberOfLines={1} style={styles.selectedPathText}>
          {getPathDisplay(currentPath)}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pathBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[2],
    borderRadius: borderRadius.md,
    marginBottom: spacing[3],
  },
  upButton: {
    padding: spacing[1],
    marginRight: spacing[2],
  },
  upButtonDisabled: {
    opacity: 0.5,
  },
  pathText: {
    flex: 1,
  },
  newFolderButton: {
    padding: spacing[1],
    marginLeft: spacing[2],
  },
  newFolderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[2],
    borderRadius: borderRadius.md,
    marginBottom: spacing[3],
  },
  newFolderInput: {
    flex: 1,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    fontSize: 14,
  },
  list: {
    maxHeight: 300,
    minHeight: 200,
  },
  listContent: {
    paddingBottom: spacing[2],
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderBottomWidth: 1,
    gap: spacing[2],
  },
  entryName: {
    flex: 1,
  },
  centered: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryButton: {
    marginTop: spacing[2],
  },
  emptyState: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing[2],
  },
  emptyText: {
    textAlign: 'center' as const,
  },
  createFirstButton: {
    marginTop: spacing[2],
  },
  selectedPath: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[2],
    borderRadius: borderRadius.md,
    marginTop: spacing[3],
  },
  selectedPathText: {
    flex: 1,
  },
});
