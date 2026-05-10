import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { AgentBridge, WorktreeDiffResult, WorktreeDiffFile, WorktreeInfo } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('WorktreeDiffPanel');

export interface WorktreeDiffPanelProps {
  bridge: AgentBridge;
  projectId: string;
  sessionId: string;
  worktree: WorktreeInfo;
  onMerge?: () => void;
  onDiscard?: () => void;
}

/**
 * Panel that shows git diff for a worktree session,
 * with merge/discard action buttons.
 */
export function WorktreeDiffPanel({
  bridge,
  projectId,
  sessionId,
  worktree,
  onMerge,
  onDiscard,
}: WorktreeDiffPanelProps) {
  const { colors, palette } = useTheme();
  const [diff, setDiff] = useState<WorktreeDiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchDiff = useCallback(async () => {
    if (!bridge.getWorktreeDiff) {
      setError('Worktree diff not supported');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const result = await bridge.getWorktreeDiff(projectId, sessionId);
      setDiff(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get diff');
    } finally {
      setLoading(false);
    }
  }, [bridge, projectId, sessionId]);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const handleMerge = useCallback(async () => {
    if (!bridge.mergeWorktree) return;
    setActionLoading(true);
    try {
      const result = await bridge.mergeWorktree(projectId, sessionId);
      setActionResult(result);
      if (result.success) onMerge?.();
    } catch (e) {
      setActionResult({ success: false, message: e instanceof Error ? e.message : 'Merge failed' });
    } finally {
      setActionLoading(false);
    }
  }, [bridge, projectId, sessionId, onMerge]);

  const handleDiscard = useCallback(async () => {
    if (!bridge.discardWorktree) return;
    setActionLoading(true);
    try {
      const result = await bridge.discardWorktree(projectId, sessionId);
      setActionResult(result);
      if (result.success) onDiscard?.();
    } catch (e) {
      setActionResult({ success: false, message: e instanceof Error ? e.message : 'Discard failed' });
    } finally {
      setActionLoading(false);
    }
  }, [bridge, projectId, sessionId, onDiscard]);

  const statusColor = (status: WorktreeDiffFile['status']) => {
    switch (status) {
      case 'added': return palette.green;
      case 'deleted': return colors.error;
      case 'renamed': return colors.info;
      default: return palette.yellow;
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Spinner size="large" />
        <Text color="muted" style={styles.loadingText}>Loading diff...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text color="error">{error}</Text>
        <Pressable onPress={fetchDiff} style={styles.retryButton}>
          <Text style={{ color: colors.primary }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header with worktree info */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <View style={styles.headerInfo}>
          <Text style={[styles.branchLabel, { color: colors.text.muted }]}>Worktree</Text>
          <Text style={[styles.branchName, { color: colors.text.primary }]}>{worktree.branch}</Text>
          <Text style={[styles.baseBranch, { color: colors.text.muted }]}>from {worktree.baseBranch}</Text>
        </View>
        {worktree.status === 'active' && (
          <View style={styles.actions}>
            <Pressable
              onPress={handleMerge}
              disabled={actionLoading}
              style={[styles.mergeButton, { backgroundColor: palette.greenDark }, actionLoading && styles.disabledButton]}
            >
              <Text style={[styles.mergeButtonText, { color: colors.text.inverse }]}>Merge</Text>
            </Pressable>
            <Pressable
              onPress={handleDiscard}
              disabled={actionLoading}
              style={[styles.discardButton, { backgroundColor: palette.errorHover }, actionLoading && styles.disabledButton]}
            >
              <Text style={[styles.discardButtonText, { color: colors.text.inverse }]}>Discard</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Action result */}
      {actionResult && (
        <View style={[styles.actionResult, { backgroundColor: actionResult.success ? palette.successMuted : palette.errorMuted }]}>
          <Text style={{ color: actionResult.success ? palette.green : colors.error }}>
            {actionResult.message}
          </Text>
        </View>
      )}

      {/* Stats */}
      {diff && (
        <View style={[styles.stats, { borderBottomColor: colors.border.light }]}>
          <Text style={[styles.statText, { color: colors.text.muted }]}>
            {diff.filesChanged} file{diff.filesChanged !== 1 ? 's' : ''} changed
          </Text>
          <Text style={[styles.statText, { color: palette.green }]}>+{diff.additions}</Text>
          <Text style={[styles.statText, { color: colors.error }]}>-{diff.deletions}</Text>
          <Pressable onPress={fetchDiff} style={styles.refreshButton}>
            <Text style={{ color: colors.primary, fontSize: 12 }}>Refresh</Text>
          </Pressable>
        </View>
      )}

      {/* File list */}
      <ScrollView style={styles.fileList}>
        {diff?.files.map((file) => (
          <View key={file.path}>
            <Pressable
              onPress={() => toggleFile(file.path)}
              style={[styles.fileHeader, { borderBottomColor: colors.border.light }]}
            >
              <View style={[styles.statusBadge, { backgroundColor: statusColor(file.status) }]}>
                <Text style={[styles.statusText, { color: colors.text.inverse }]}>{file.status[0].toUpperCase()}</Text>
              </View>
              <Text style={[styles.fileName, { color: colors.text.primary }]} numberOfLines={1}>
                {file.path}
              </Text>
              <Text style={[styles.fileStats, { color: palette.green }]}>+{file.additions}</Text>
              <Text style={[styles.fileStats, { color: colors.error }]}>-{file.deletions}</Text>
            </Pressable>
            {expandedFiles.has(file.path) && file.diff ? (
              <ScrollView horizontal style={[styles.diffContainer, { backgroundColor: colors.bg.primary }]}>
                <Text style={[styles.diffText, { color: colors.text.secondary }]} selectable>
                  {file.diff}
                </Text>
              </ScrollView>
            ) : null}
          </View>
        ))}
        {diff?.files.length === 0 && (
          <View style={[styles.centered, { padding: spacing[4] }]}>
            <Text color="muted">No changes in worktree</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacing[3],
  },
  retryButton: {
    padding: spacing[2],
    marginTop: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    borderBottomWidth: 1,
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flex: 1,
  },
  branchLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  branchName: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  baseBranch: {
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  mergeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  mergeButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  discardButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  discardButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
  actionResult: {
    padding: spacing[3],
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderBottomWidth: 1,
  },
  statText: {
    fontSize: 13,
    fontWeight: '500',
  },
  refreshButton: {
    marginLeft: 'auto',
  },
  fileList: {
    flex: 1,
  },
  fileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[2],
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    gap: spacing[2],
  },
  statusBadge: {
    width: 20,
    height: 20,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  fileName: {
    fontSize: 13,
    fontFamily: 'monospace',
    flex: 1,
  },
  fileStats: {
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  diffContainer: {
    maxHeight: 300,
  },
  diffText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    padding: spacing[3],
  },
});
