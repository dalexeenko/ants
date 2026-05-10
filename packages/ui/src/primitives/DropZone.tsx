import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Text } from './Text';
import { Icon } from './IconButton';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';

export interface DroppedFile {
  name: string;
  size: number;
  type: string;
  /** File object for web, path for native */
  file?: File;
  path?: string;
}

export interface DropZoneProps {
  /** Content to render inside the drop zone */
  children: React.ReactNode;
  /** Called when files are dropped */
  onDrop: (files: DroppedFile[]) => void;
  /** Accepted file types (e.g., '.txt,.md' or 'image/*') */
  accept?: string;
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Maximum number of files */
  maxFiles?: number;
  /** Whether drop zone is disabled */
  disabled?: boolean;
  /** Custom message to show when dragging over */
  dropMessage?: string;
}

/**
 * Drop zone component for drag-and-drop file uploads.
 * Wraps children and shows overlay when files are dragged over.
 */
export function DropZone({
  children,
  onDrop,
  accept,
  maxSize = 10 * 1024 * 1024, // 10MB default
  maxFiles = 10,
  disabled = false,
  dropMessage = 'Drop files here',
}: DropZoneProps) {
  const { colors } = useTheme();
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = React.useRef(0);

  const processFiles = useCallback((files: File[]) => {
    // Filter by accepted types
    let filteredFiles = files;
    if (accept) {
      const acceptedTypes = accept.split(',').map(t => t.trim().toLowerCase());
      filteredFiles = files.filter(file => {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase();
        const mimeType = file.type.toLowerCase();
        return acceptedTypes.some(accepted => {
          if (accepted.startsWith('.')) {
            return ext === accepted;
          }
          if (accepted.endsWith('/*')) {
            return mimeType.startsWith(accepted.replace('/*', '/'));
          }
          return mimeType === accepted;
        });
      });
    }

    // Filter by size
    filteredFiles = filteredFiles.filter(f => f.size <= maxSize);

    // Limit count
    filteredFiles = filteredFiles.slice(0, maxFiles);

    if (filteredFiles.length === 0) return;

    // Convert to DroppedFile format
    const droppedFiles: DroppedFile[] = filteredFiles.map(file => ({
      name: file.name,
      size: file.size,
      type: file.type,
      file,
    }));

    onDrop(droppedFiles);
  }, [accept, maxSize, maxFiles, onDrop]);

  // Web-specific event handlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDragEnter = useCallback((e: any) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  }, [disabled]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDragLeave = useCallback((e: any) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDragOver = useCallback((e: any) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDrop = useCallback((e: any) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    if (disabled || !e.dataTransfer?.files) return;

    const files = Array.from(e.dataTransfer.files) as File[];
    processFiles(files);
  }, [disabled, processFiles]);

  // For web, use div with native event handlers
  if (Platform.OS === 'web') {
    return (
      <div
        style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {children}
        {isDragOver && (
          <View
            style={[
              styles.overlay,
              {
                backgroundColor: colors.primary + '20',
                borderColor: colors.primary,
              },
            ]}
          >
            <View style={[styles.dropIndicator, { backgroundColor: colors.bg.elevated }]}>
              <Icon name="folder" size={32} color={colors.primary} />
              <Text style={{ color: colors.primary }}>{dropMessage}</Text>
            </View>
          </View>
        )}
      </div>
    );
  }

  // For native platforms, just render children (native drag-drop requires platform-specific implementation)
  return <View style={styles.container}>{children}</View>;
}

/**
 * Hook to manage dropped files state.
 */
export function useDroppedFiles(maxFiles = 10) {
  const [files, setFiles] = useState<DroppedFile[]>([]);

  const addFiles = useCallback((newFiles: DroppedFile[]) => {
    setFiles(prev => {
      const combined = [...prev, ...newFiles];
      return combined.slice(0, maxFiles);
    });
  }, [maxFiles]);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
  }, []);

  return {
    files,
    addFiles,
    removeFile,
    clearFiles,
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: borderRadius.lg,
    zIndex: 1000,
  },
  dropIndicator: {
    padding: spacing[4],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    gap: spacing[2],
  },
  dropIcon: {
    fontSize: 32,
  },
});
