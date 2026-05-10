import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';

export interface AttachedFile {
  id: string;
  name: string;
  path: string;
  size: number;
  type: 'file' | 'image' | 'code';
}

export interface FileAttachmentProps {
  /** The attached file */
  file: AttachedFile;
  /** Called when remove is clicked */
  onRemove: () => void;
  /** Whether the attachment can be removed */
  removable?: boolean;
}

/**
 * Single file attachment display component.
 */
export function FileAttachment({ file, onRemove, removable = true }: FileAttachmentProps) {
  const { colors } = useTheme();

  const getIcon = () => {
    switch (file.type) {
      case 'image':
        return '🖼️';
      case 'code':
        return '📄';
      default:
        return '📎';
    }
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bg.secondary, borderColor: colors.border.light },
      ]}
    >
      <Text style={styles.icon}>{getIcon()}</Text>
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.text.primary }]} numberOfLines={1}>
          {file.name}
        </Text>
        <Text style={[styles.size, { color: colors.text.muted }]}>
          {formatFileSize(file.size)}
        </Text>
      </View>
      {removable && (
        <Pressable style={styles.removeButton} onPress={onRemove}>
          <Text style={[styles.removeIcon, { color: colors.text.muted }]}>×</Text>
        </Pressable>
      )}
    </View>
  );
}

// ============ File Attachment List ============

export interface FileAttachmentListProps {
  /** List of attached files */
  files: AttachedFile[];
  /** Called when a file is removed */
  onRemove: (fileId: string) => void;
  /** Called when add is clicked */
  onAdd?: () => void;
  /** Maximum number of files allowed */
  maxFiles?: number;
}

/**
 * List of file attachments with add button.
 */
export function FileAttachmentList({
  files,
  onRemove,
  onAdd,
  maxFiles = 10,
}: FileAttachmentListProps) {
  const { colors } = useTheme();
  const canAdd = files.length < maxFiles;

  if (files.length === 0 && !onAdd) {
    return null;
  }

  return (
    <View style={styles.list}>
      {files.map((file) => (
        <FileAttachment
          key={file.id}
          file={file}
          onRemove={() => onRemove(file.id)}
        />
      ))}
      {onAdd && canAdd && (
        <Pressable
          style={[
            styles.addButton,
            { borderColor: colors.border.medium },
          ]}
          onPress={onAdd}
        >
          <Text style={[styles.addIcon, { color: colors.text.muted }]}>+</Text>
          <Text style={[styles.addText, { color: colors.text.muted }]}>
            Add file
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ============ Compact Attachment Indicator ============

export interface AttachmentIndicatorProps {
  /** Number of files attached */
  count: number;
  /** Called when clicked */
  onPress: () => void;
}

/**
 * Compact indicator showing attachment count.
 */
export function AttachmentIndicator({ count, onPress }: AttachmentIndicatorProps) {
  const { colors } = useTheme();

  if (count === 0) {
    return null;
  }

  return (
    <Pressable
      style={[styles.indicator, { backgroundColor: colors.bg.tertiary }]}
      onPress={onPress}
    >
      <Text style={styles.indicatorIcon}>📎</Text>
      <Text style={[styles.indicatorCount, { color: colors.text.secondary }]}>
        {count}
      </Text>
    </Pressable>
  );
}

// ============ Helpers ============

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============ Styles ============

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing[2],
    maxWidth: 200,
  },
  icon: {
    fontSize: 16,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 12,
    fontWeight: '500',
  },
  size: {
    fontSize: 10,
  },
  removeButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeIcon: {
    fontSize: 16,
    fontWeight: '600',
  },
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: spacing[1],
  },
  addIcon: {
    fontSize: 16,
  },
  addText: {
    fontSize: 12,
  },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    gap: spacing[1],
  },
  indicatorIcon: {
    fontSize: 12,
  },
  indicatorCount: {
    fontSize: 12,
    fontWeight: '500',
  },
});
