/**
 * New Project Screen
 *
 * Full-screen project creation flow using the shared ProjectSetupForm.
 * This wraps the form in a full-screen layout with a header, suitable for mobile.
 *
 * Directory browsing uses the in-app DirectoryPicker modal (provided by
 * ProjectSetupForm) rather than a separate full-screen navigator, which avoids
 * the complexity of lifting form state across screen transitions.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Icon, ProjectSetupForm, useTheme, spacing } from '@openmgr/ui';
import type { AgentBridge } from '@openmgr/ui';
import { File } from 'expo-file-system';
import {
  createLocalFilesystemProvider,
  getDefaultProjectsDirectory,
  ensureDefaultProjectsDirectory,
  ensureDirectoryExists,
} from '../services/LocalFilesystemProvider';

interface NewProjectScreenProps {
  bridge: AgentBridge;
  onNavigateBack: () => void;
  onProjectCreated: (projectId: string) => void;
}

export function NewProjectScreen({
  bridge,
  onNavigateBack,
  onProjectCreated,
}: NewProjectScreenProps) {
  const { colors } = useTheme();

  const handleEnsureDirectory = (path: string) => {
    ensureDefaultProjectsDirectory();
    ensureDirectoryExists(path);
  };

  const handleWriteFile = async (filePath: string, content: string) => {
    const uri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
    const file = new File(uri);
    file.write(content);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <Pressable onPress={onNavigateBack} style={styles.headerButton}>
          <Icon name="arrow-left" size={24} color={colors.text.primary} />
        </Pressable>
        <Text variant="heading" style={styles.headerTitle}>
          New Project
        </Text>
        <View style={styles.headerButton} />
      </View>

      {/* Form content */}
      <View style={styles.formContainer}>
        <ProjectSetupForm
          bridge={bridge}
          onProjectCreated={(project) => onProjectCreated(project.id)}
          onCancel={onNavigateBack}
          createLocalFilesystemProvider={createLocalFilesystemProvider}
          getDefaultProjectsDirectory={getDefaultProjectsDirectory}
          ensureDirectoryExists={handleEnsureDirectory}
          writeFile={handleWriteFile}
          showFooter={true}
          scrollable={true}
        />
      </View>
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
  headerButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  formContainer: {
    flex: 1,
    padding: spacing[4],
  },
});
