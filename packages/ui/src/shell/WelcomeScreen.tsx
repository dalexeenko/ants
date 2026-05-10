import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  ThemeContext,
  useProjectStore,
  Text,
  Button,
  Card,
  AuthenticationSection,
  ProjectSetupModal,
  type Project,
} from '../index';
import { usePlatform } from '../platform/PlatformContext';

export function WelcomeScreen() {
  const { colors } = React.useContext(ThemeContext);
  const platform = usePlatform();
  const { addProject, setCurrentProject } = useProjectStore();
  const [showProjectSetup, setShowProjectSetup] = useState(false);
  const [documentsPath, setDocumentsPath] = useState<string | null>(null);
  useEffect(() => {
    platform.getDocumentsPath?.()
      .then((p: string) => setDocumentsPath(p))
      .catch(() => {});
  }, [platform]);

  const handleProjectCreated = (project: Project) => {
    addProject(project);
    setCurrentProject(project.id);
    setShowProjectSetup(false);
  };

  const suggestions = [
    { label: 'Fix a bug', prompt: 'Find and fix a bug in my code' },
    { label: 'Review code', prompt: 'Review my code for quality and correctness' },
    { label: 'Write tests', prompt: 'Write tests for my code' },
    { label: 'Open a PR', prompt: 'Create a pull request with my changes' },
  ];

  return (
    <View testID="ants-welcome-screen" style={[styles.welcomeContainer, { backgroundColor: colors.bg.primary }]}>
      <View style={styles.welcomeContent}>
        <Text variant="title" style={styles.welcomeTitle}>
          What should we work on?
        </Text>
        <Text color="secondary" style={styles.welcomeSubtitle}>
          Agents write code, run tests, verify output, and open PRs — without waiting for you in the middle.
        </Text>

        {/* Auth section — only for non-web platforms */}
        {platform.platform !== 'web' && window.agentBridge && (
          <View style={{ marginBottom: 16, maxWidth: 480, width: '100%' }}>
            <AuthenticationSection bridge={window.agentBridge} />
          </View>
        )}

        <Card variant="outlined" padding="lg" style={styles.welcomeCard}>
          <Text variant="heading" style={styles.cardTitle}>
            Start a new project
          </Text>
          <Text color="secondary" style={styles.cardDescription}>
            Each project gets its own AI session, sandbox, tool suite, and persistent state.
          </Text>
          <Button testID="ants-welcome-new-project" onPress={() => setShowProjectSetup(true)} style={styles.openButton}>
            New Project
          </Button>
        </Card>

        <View style={styles.suggestionsRow}>
          {suggestions.map((s) => (
            <Pressable
              key={s.label}
              style={({ pressed }) => [
                styles.suggestionChip,
                { backgroundColor: colors.bg.secondary, borderColor: colors.border.light },
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setShowProjectSetup(true)}
            >
              <Text variant="caption" color="secondary">{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {window.agentBridge && (
        <ProjectSetupModal
          visible={showProjectSetup}
          onClose={() => setShowProjectSetup(false)}
          onProjectCreated={handleProjectCreated}
          bridge={window.agentBridge}
          openNativeDirectoryPicker={() =>
            platform.openDirectoryDialog?.() ?? Promise.resolve(null)
          }
          getDefaultProjectsDirectory={documentsPath ? () => `${documentsPath}/Ants Projects` : undefined}
          ensureDirectoryExists={async (p) => {
            await platform.ensureDirectoryExists?.(p);
          }}
          writeFile={async (filePath, content) => {
            await platform.writeFile?.(filePath, content);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  welcomeContent: {
    maxWidth: 500,
    width: '100%',
    alignItems: 'center',
  },
  welcomeTitle: {
    marginBottom: 8,
    textAlign: 'center' as const,
  },
  welcomeSubtitle: {
    marginBottom: 32,
    textAlign: 'center' as const,
  },
  welcomeCard: {
    width: '100%',
    marginBottom: 16,
  },
  cardTitle: {
    marginBottom: 8,
  },
  cardDescription: {
    marginBottom: 16,
  },
  openButton: {
    width: '100%',
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 16,
  },
  suggestionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
});
