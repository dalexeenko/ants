/**
 * FileEditorTab - Code editor for files opened in the middle panel.
 *
 * Supports editing file content with a monospace TextInput and saving
 * changes back via the bridge. Watches for external file changes and
 * auto-reloads when no local edits exist, or prompts the user when
 * there are unsaved modifications.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, ScrollView, TextInput, Pressable, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { Text } from '../primitives/Text';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { spacing, fontSize, borderRadius } from '../styles/tokens';
import type { AgentBridge, AgentEvent } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('FileEditorTab');

interface FileEditorTabProps {
  filePath: string;
  projectId: string;
  bridge: AgentBridge;
}

export function FileEditorTab({ filePath, projectId, bridge }: FileEditorTabProps) {
  const { colors, palette } = useTheme();
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const textInputRef = useRef<TextInput>(null);

  // Use refs so the event subscription callback always sees the latest values
  // without needing to re-subscribe on every state change.
  const savedContentRef = useRef(savedContent);
  const editedContentRef = useRef(editedContent);
  savedContentRef.current = savedContent;
  editedContentRef.current = editedContent;

  const isModified = savedContent !== null && editedContent !== null && savedContent !== editedContent;

  // Reload file content from disk
  const reloadFile = useCallback(async () => {
    try {
      const fileContent = await bridge.readFile(projectId, filePath);
      setSavedContent(fileContent);
      setEditedContent(fileContent);
      setExternalChange(false);
      log.debug('File reloaded:', filePath);
    } catch (e) {
      log.error('Failed to reload file:', e);
    }
  }, [bridge, projectId, filePath]);

  // Initial file load
  useEffect(() => {
    let cancelled = false;

    const loadFile = async () => {
      setLoading(true);
      setError(null);
      setSaveError(null);
      setExternalChange(false);
      try {
        const fileContent = await bridge.readFile(projectId, filePath);
        if (!cancelled) {
          setSavedContent(fileContent);
          setEditedContent(fileContent);
        }
      } catch (e) {
        if (!cancelled) {
          log.error('Failed to load file:', e);
          setError(e instanceof Error ? e.message : 'Failed to load file');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadFile();
    return () => { cancelled = true; };
  }, [filePath, projectId, bridge]);

  // Watch file for external changes
  useEffect(() => {
    // Start watching
    bridge.watchFile(projectId, filePath).catch((e) => {
      log.debug('watchFile not supported or failed:', e);
    });

    // Subscribe to project events to receive file.changed notifications
    const unsubscribe = bridge.subscribeToProject(projectId, (event: AgentEvent) => {
      if (event.type === 'file.changed' && event.filePath === filePath) {
        const hasLocalEdits = savedContentRef.current !== editedContentRef.current;
        if (hasLocalEdits) {
          // User has unsaved edits — show conflict banner
          setExternalChange(true);
        } else {
          // No local edits — silently reload
          bridge.readFile(projectId, filePath).then((content) => {
            setSavedContent(content);
            setEditedContent(content);
          }).catch((e) => {
            log.error('Failed to auto-reload file:', e);
          });
        }
      }
    });

    return () => {
      unsubscribe();
      bridge.unwatchFile(projectId, filePath).catch((e) => {
        log.debug('unwatchFile failed:', e);
      });
    };
  }, [filePath, projectId, bridge]);

  const handleSave = useCallback(async () => {
    if (editedContent === null || !isModified) return;

    setSaving(true);
    setSaveError(null);
    try {
      await bridge.writeFile(projectId, filePath, editedContent);
      setSavedContent(editedContent);
      setExternalChange(false);
      log.info('File saved:', filePath);
    } catch (e) {
      log.error('Failed to save file:', e);
      setSaveError(e instanceof Error ? e.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  }, [editedContent, isModified, bridge, projectId, filePath]);

  // Keyboard shortcut: Ctrl/Cmd+S to save
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <Spinner size="small" />
        <Text color="muted" style={{ marginTop: spacing[2] }}>Loading file...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={{ color: colors.error }}>{error}</Text>
      </View>
    );
  }

  if (editedContent === null) {
    return null;
  }

  const lineCount = editedContent.split('\n').length;

  const editorBody = (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* File path header with save controls */}
      <View style={[styles.pathHeader, { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light }]}>
        <View style={styles.pathRow}>
          <Text style={[styles.pathText, { color: colors.text.muted }]} numberOfLines={1}>
            {filePath}
          </Text>
          {isModified && (
            <Text style={[styles.modifiedBadge, { color: colors.text.muted }]}>Modified</Text>
          )}
        </View>
        <View style={styles.headerRight}>
          <Text style={[styles.lineCount, { color: colors.text.muted }]}>
            {lineCount} lines
          </Text>
          {saving ? (
            <View style={styles.saveButton}>
              <Spinner size="small" />
            </View>
          ) : (
            <Pressable
              onPress={handleSave}
              disabled={!isModified}
              style={({ pressed }) => [
                styles.saveButton,
                {
                  backgroundColor: isModified
                    ? (pressed ? palette.primaryHover : colors.primary)
                    : colors.bg.tertiary,
                  opacity: isModified ? 1 : 0.5,
                },
              ]}
            >
              <Text style={[
                styles.saveButtonText,
                { color: isModified ? colors.text.inverse : colors.text.muted },
              ]}>
                Save
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* External change banner */}
      {externalChange && (
        <View style={[styles.changeBanner, { backgroundColor: colors.bg.tertiary, borderBottomColor: colors.border.light }]}>
          <Text style={{ color: colors.text.primary, fontSize: fontSize.xs, flex: 1 }}>
            File changed on disk.
          </Text>
          <View style={styles.changeBannerActions}>
            <Pressable
              onPress={reloadFile}
              style={({ pressed }) => [
                styles.bannerButton,
                { backgroundColor: pressed ? palette.primaryHover : colors.primary },
              ]}
            >
              <Text style={[styles.bannerButtonText, { color: colors.text.inverse }]}>Reload</Text>
            </Pressable>
            <Pressable
              onPress={() => setExternalChange(false)}
              style={({ pressed }) => [
                styles.bannerButton,
                { backgroundColor: pressed ? colors.border.medium : colors.bg.secondary },
              ]}
            >
              <Text style={[styles.bannerButtonText, { color: colors.text.primary }]}>Keep Local</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Save error banner */}
      {saveError && (
        <View style={[styles.errorBanner, { backgroundColor: colors.error }]}>
          <Text style={{ color: colors.text.inverse, fontSize: fontSize.xs }}>{saveError}</Text>
        </View>
      )}

      {/* Editable content */}
      <ScrollView
        style={styles.scrollView}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.editorContainer}>
          {/* Line numbers gutter */}
          <View style={styles.gutterContainer}>
            {editedContent.split('\n').map((_, idx) => (
              <Text key={idx} style={[styles.lineNumber, { color: colors.text.muted }]}>
                {String(idx + 1).padStart(4)}
              </Text>
            ))}
          </View>
          {/* TextInput editor */}
          <TextInput
            ref={textInputRef}
            value={editedContent}
            onChangeText={setEditedContent}
            multiline
            style={[
              styles.textInput,
              {
                color: colors.text.primary,
                // On web, outline: 'none' removes the focus ring
                ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
              },
            ]}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textAlignVertical="top"
          />
        </View>
      </ScrollView>
    </View>
  );

  if (Platform.OS === 'web') {
    return editorBody;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}
    >
      {editorBody}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  pathHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  pathRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    overflow: 'hidden',
  },
  pathText: {
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
  modifiedBadge: {
    fontSize: fontSize.xs,
    fontStyle: 'italic',
    flexShrink: 0,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginLeft: spacing[2],
    flexShrink: 0,
  },
  lineCount: {
    fontSize: fontSize.xs,
  },
  saveButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 50,
    minHeight: 28,
  },
  saveButtonText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  changeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderBottomWidth: 1,
    gap: spacing[2],
  },
  changeBannerActions: {
    flexDirection: 'row',
    gap: spacing[1.5],
  },
  bannerButton: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[0.5],
    borderRadius: borderRadius.sm,
  },
  bannerButtonText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  errorBanner: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
  },
  scrollView: {
    flex: 1,
  },
  editorContainer: {
    flexDirection: 'row',
    minHeight: '100%',
  },
  gutterContainer: {
    paddingTop: spacing[2],
    paddingLeft: spacing[2],
    paddingRight: spacing[1],
    userSelect: 'none',
  },
  lineNumber: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 20,
    width: 40,
    textAlign: 'right',
  },
  textInput: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 20,
    padding: spacing[2],
    paddingLeft: spacing[1],
    textAlignVertical: 'top',
  },
});
