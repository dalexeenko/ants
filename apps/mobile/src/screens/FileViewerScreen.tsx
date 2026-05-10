import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import {
  ThemeContext,
  Text,
  IconButton,
  Spinner,
  spacing,
  type AgentBridge,
  createLogger,
} from '@openmgr/ui';

const log = createLogger('FileViewerScreen');

/** Max file size we'll attempt to display (1 MB) */
export const MAX_DISPLAY_SIZE = 1024 * 1024;

/** File extensions we know are binary and shouldn't be displayed as text */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.sqlite', '.db',
]);

export function getFileExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return '';
  return path.substring(dot).toLowerCase();
}

export function isBinaryFile(path: string): boolean {
  return BINARY_EXTENSIONS.has(getFileExtension(path));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileViewerScreenProps {
  bridge: AgentBridge;
  projectId: string;
  filePath: string;
  fileName: string;
  fileSize?: number;
  onNavigateBack: () => void;
}

export function FileViewerScreen({
  bridge,
  projectId,
  filePath,
  fileName,
  fileSize,
  onNavigateBack,
}: FileViewerScreenProps) {
  const { colors } = React.useContext(ThemeContext);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(0);

  useEffect(() => {
    const loadFile = async () => {
      setLoading(true);
      setError(null);
      setContent(null);

      // Check for binary files
      if (isBinaryFile(filePath)) {
        setError('Binary files cannot be displayed as text.');
        setLoading(false);
        return;
      }

      // Check file size if known
      if (fileSize && fileSize > MAX_DISPLAY_SIZE) {
        setError(`File is too large to display (${formatFileSize(fileSize)}). Maximum size is ${formatFileSize(MAX_DISPLAY_SIZE)}.`);
        setLoading(false);
        return;
      }

      try {
        const text = await bridge.readFile(projectId, filePath);

        // Check if the content looks binary (contains null bytes)
        if (text.includes('\0')) {
          setError('This file appears to contain binary data and cannot be displayed as text.');
          setLoading(false);
          return;
        }

        // Truncate very large content that slipped past the size check
        if (text.length > MAX_DISPLAY_SIZE) {
          setContent(text.substring(0, MAX_DISPLAY_SIZE) + '\n\n--- Truncated (file too large) ---');
          setLineCount(text.substring(0, MAX_DISPLAY_SIZE).split('\n').length);
        } else {
          setContent(text);
          setLineCount(text.split('\n').length);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to read file';
        log.error('Failed to read file:', filePath, e);
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [bridge, projectId, filePath, fileSize]);

  const ext = getFileExtension(filePath);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <IconButton icon="arrow-left" size="md" onPress={onNavigateBack} />
        <View style={styles.headerTitle}>
          <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
            {fileName}
          </Text>
          <Text variant="caption" style={{ color: colors.text.muted }} numberOfLines={1}>
            {filePath}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* File info bar */}
      <View style={[styles.infoBar, { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light }]}>
        {ext ? (
          <Text variant="caption" style={{ color: colors.text.muted }}>
            {ext.substring(1).toUpperCase()}
          </Text>
        ) : null}
        {fileSize != null && (
          <Text variant="caption" style={{ color: colors.text.muted }}>
            {formatFileSize(fileSize)}
          </Text>
        )}
        {!loading && content != null && (
          <Text variant="caption" style={{ color: colors.text.muted }}>
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </Text>
        )}
      </View>

      {/* Content area */}
      {loading && (
        <View style={styles.centered}>
          <Spinner size="large" />
          <Text variant="body" style={{ color: colors.text.muted, marginTop: spacing[3] }}>
            Loading file...
          </Text>
        </View>
      )}

      {error && (
        <View style={styles.centered}>
          <Text variant="body" style={{ color: colors.error, textAlign: 'center', paddingHorizontal: spacing[4] }}>
            {error}
          </Text>
        </View>
      )}

      {!loading && !error && content != null && (
        <ScrollView
          style={styles.scrollView}
          horizontal={false}
          showsVerticalScrollIndicator={true}
        >
          <ScrollView
            horizontal={true}
            showsHorizontalScrollIndicator={true}
            contentContainerStyle={styles.horizontalScroll}
          >
            <View style={styles.codeContainer}>
              {/* Line numbers */}
              <View style={[styles.lineNumbers, { borderRightColor: colors.border.light }]}>
                {content.split('\n').map((_, i) => (
                  <Text
                    key={i}
                    style={[styles.lineNumber, { color: colors.text.muted }]}
                  >
                    {i + 1}
                  </Text>
                ))}
              </View>

              {/* File content */}
              <View style={styles.codeContent}>
                <Text
                  style={[styles.codeText, { color: colors.text.primary }]}
                  selectable={true}
                >
                  {content}
                </Text>
              </View>
            </View>
          </ScrollView>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  headerTitle: {
    flex: 1,
    alignItems: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  infoBar: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
    borderBottomWidth: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  horizontalScroll: {
    flexGrow: 1,
  },
  codeContainer: {
    flexDirection: 'row',
    paddingVertical: spacing[2],
  },
  lineNumbers: {
    paddingHorizontal: spacing[2],
    borderRightWidth: 1,
    alignItems: 'flex-end',
    minWidth: 40,
  },
  lineNumber: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  codeContent: {
    paddingHorizontal: spacing[3],
    flexShrink: 0,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});
