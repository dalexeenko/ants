/**
 * ProjectSetupForm - Shared form content for creating new projects.
 *
 * This is the platform-agnostic inner content that can be rendered:
 *  - Inside a Modal on desktop (via ProjectSetupModal)
 *  - As a full-screen layout on mobile
 *
 * Provides form fields for:
 *  1. Project name (optional)
 *  2. Provider selection (local or remote server)
 *  3. Working directory configuration (default toggle, directory browser)
 */

import React, { useState, useEffect, useMemo } from 'react';
import { View, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';
import { Switch } from '../primitives/Switch';
import { Icon } from '../primitives/IconButton';
import { DirectoryPicker, type FilesystemProvider } from '../primitives/DirectoryPicker';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { AgentBridge, RemoteServerConfig, Project } from '../agent/types';
import { TemplateSelector, type TemplateInfo } from './TemplateSelector';
import { createLogger } from '../utils/logger';

const log = createLogger('ProjectSetupForm');

export interface ProjectSetupFormProps {
  /** Called when a project is successfully created */
  onProjectCreated: (project: Project) => void;
  /** Called when the user cancels */
  onCancel: () => void;
  /** The agent bridge to use for project creation and server listing */
  bridge: AgentBridge;
  /**
   * Platform-specific filesystem provider factory for local directory browsing.
   * Desktop: uses Node.js fs via IPC. Mobile: uses expo-file-system.
   * If not provided, local directory browsing is not available.
   */
  createLocalFilesystemProvider?: () => FilesystemProvider;
  /**
   * Platform-specific function to get the default projects directory.
   * Desktop: app.getPath('documents')/Ants Projects
   * Mobile: FileSystem.documentDirectory + 'Ants Projects'
   */
  getDefaultProjectsDirectory?: () => string;
  /**
   * Platform-specific function to ensure a directory exists.
   * Called before creating a local project with a default directory path.
   */
  ensureDirectoryExists?: (path: string) => void | Promise<void>;
  /**
   * Optional: use the native OS directory picker instead of the in-app
   * DirectoryPicker. On desktop (Electron), this opens dialog.showOpenDialog.
   * Should return the selected path or null if cancelled.
   */
  openNativeDirectoryPicker?: () => Promise<string | null>;
  /**
   * Optional: callback for browsing directories via a full-screen navigator
   * (used on mobile instead of the in-app DirectoryPicker modal).
   * When provided, this replaces both openNativeDirectoryPicker and DirectoryPicker.
   */
  onBrowseDirectory?: (provider: FilesystemProvider, onSelect: (path: string) => void) => void;
  /**
   * Platform-specific function to write a file to disk.
   * Used for writing .ants.json when applying a template to a local project.
   * If not provided, local template config is not written.
   */
  writeFile?: (filePath: string, content: string) => void | Promise<void>;
  /**
   * Whether to render the Cancel/Create buttons at the bottom.
   * Set to false if the parent component provides its own footer buttons.
   * Defaults to true.
   */
  showFooter?: boolean;
  /**
   * Ref-like callback to expose the create handler to the parent.
   * Useful when showFooter=false and the parent needs to trigger creation.
   */
  onReady?: (actions: { create: () => Promise<void>; canCreate: boolean }) => void;
  /**
   * Whether to wrap content in a ScrollView. Defaults to true.
   * Set to false if the parent already provides scrolling.
   */
  scrollable?: boolean;
}

export function ProjectSetupForm({
  onProjectCreated,
  onCancel,
  bridge,
  createLocalFilesystemProvider,
  getDefaultProjectsDirectory,
  ensureDirectoryExists,
  openNativeDirectoryPicker,
  onBrowseDirectory,
  writeFile,
  showFooter = true,
  onReady,
  scrollable = true,
}: ProjectSetupFormProps) {
  const { colors } = useTheme();

  // Form state
  const [projectName, setProjectName] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<'local' | string>('local');
  const [projectPath, setProjectPath] = useState('');
  const [useDefaultDirectory, setUseDefaultDirectory] = useState(true);
  const [createSubfolder, setCreateSubfolder] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateInfo | null>(null);

  // UI state
  const [remoteServers, setRemoteServers] = useState<RemoteServerConfig[]>([]);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load remote servers on mount
  useEffect(() => {
    loadRemoteServers();
  }, []);

  const loadRemoteServers = async () => {
    try {
      const servers = await bridge.listRemoteServers();
      setRemoteServers(servers);
    } catch (e) {
      log.error('Failed to load remote servers:', e);
    }
  };

  // Compute the effective path for the project
  const effectivePath = useMemo(() => {
    if (selectedProvider !== 'local') {
      if (createSubfolder && projectPath) {
        const folderName = projectName.trim() || `project-${Date.now()}`;
        const safeName = folderName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        return `${projectPath}/${safeName}`;
      }
      return projectPath;
    }
    if (useDefaultDirectory && getDefaultProjectsDirectory) {
      const basePath = getDefaultProjectsDirectory();
      const folderName = projectName.trim() || `project-${Date.now()}`;
      const safeName = folderName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
      return `${basePath}/${safeName}`;
    }
    if (useDefaultDirectory) {
      return '';
    }
    return projectPath;
  }, [selectedProvider, useDefaultDirectory, createSubfolder, projectName, projectPath, getDefaultProjectsDirectory]);

  // Filesystem provider for the directory picker
  const filesystemProvider = useMemo((): FilesystemProvider | null => {
    if (selectedProvider === 'local') {
      return createLocalFilesystemProvider?.() ?? null;
    }
    // Remote filesystem provider via bridge
    return {
      async listDirectory(path: string) {
        const result = await bridge.listRemoteFilesystem(selectedProvider, path);
        return result.entries.map((e) => ({
          name: e.name,
          path: e.path,
          isDirectory: e.isDirectory,
        }));
      },
      async getHomePath() {
        const result = await bridge.getRemoteFilesystemHome(selectedProvider);
        return result.home;
      },
      getParentPath(path: string) {
        const normalized = path.replace(/\/$/, '');
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash <= 0) return '/';
        return normalized.substring(0, lastSlash);
      },
      isRoot(path: string) {
        return path === '/' || path === '';
      },
      async createDirectory(parentPath: string, name: string) {
        return bridge.createRemoteDirectory(selectedProvider, parentPath, name);
      },
    };
  }, [bridge, selectedProvider, createLocalFilesystemProvider]);

  const canCreate =
    !creating &&
    (selectedProvider !== 'local' || useDefaultDirectory || !!projectPath);

  const getProviderDisplayName = () => {
    if (selectedProvider === 'local') return 'Local';
    const server = remoteServers.find((s) => s.id === selectedProvider);
    return server?.name || 'Remote Server';
  };

  const handleSelectProvider = (provider: 'local' | string) => {
    setSelectedProvider(provider);
    setShowProviderPicker(false);
    setProjectPath('');
    setError(null);
  };

  const handleBrowseDirectory = async () => {
    const isLocal = selectedProvider === 'local';

    // Priority: full-screen browser > native picker (local only) > in-app DirectoryPicker
    if (onBrowseDirectory && filesystemProvider) {
      onBrowseDirectory(filesystemProvider, (selected) => {
        setProjectPath(selected);
      });
      return;
    }
    if (isLocal && openNativeDirectoryPicker) {
      // Native OS picker only works for local filesystem
      const selected = await openNativeDirectoryPicker();
      if (selected) {
        setProjectPath(selected);
      }
      return;
    }
    // For remote providers (or when no native picker), use the in-app DirectoryPicker
    if (filesystemProvider) {
      setShowDirectoryPicker(true);
    }
  };

  const handleDirectorySelected = (path: string) => {
    setProjectPath(path);
    setShowDirectoryPicker(false);
  };

  const handleCreateProject = async () => {
    log.debug('handleCreateProject: Called with projectName:', JSON.stringify(projectName), 'selectedProvider:', selectedProvider, 'useDefaultDirectory:', useDefaultDirectory, 'projectPath:', projectPath, 'effectivePath:', effectivePath, 'template:', selectedTemplate?.slug);
    if (selectedProvider === 'local' && !useDefaultDirectory && !projectPath) {
      setError('Please select a working directory');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      let pathToUse = '';

      if (selectedProvider === 'local') {
        if (useDefaultDirectory) {
          pathToUse = effectivePath;
          if (ensureDirectoryExists && pathToUse) {
            await ensureDirectoryExists(pathToUse);
          }
        } else {
          pathToUse = projectPath;
        }
      } else {
        pathToUse = effectivePath;
      }

      // Remote project with template: use the template creation endpoint
      if (selectedProvider !== 'local' && selectedTemplate) {
        log.info('Creating remote project from template:', selectedTemplate.slug);
        const response = await bridge.remoteServerFetch(
          selectedProvider,
          `/templates/${selectedTemplate.slug}/create-project`,
          {
            method: 'POST',
            body: JSON.stringify({
              name: projectName || undefined,
              workingDirectory: pathToUse,
            }),
          },
        );

        if (!response.ok) {
          const errData = JSON.parse(response.body);
          throw new Error(errData.error || `Template creation failed (${response.status})`);
        }

        const data = JSON.parse(response.body);
        log.debug('Template project created:', data);

        // Register the project locally via bridge.createProject so it appears in the UI
        const project = await bridge.createProject(
          pathToUse,
          'remote',
          selectedProvider,
          projectName || data.project?.name || undefined,
        );

        onProjectCreated(project);
        return;
      }

      log.debug('handleCreateProject: Calling bridge.createProject with path:', pathToUse, 'name:', JSON.stringify(projectName || undefined));
      const project = await bridge.createProject(
        pathToUse,
        selectedProvider === 'local' ? 'local' : 'remote',
        selectedProvider === 'local' ? undefined : selectedProvider,
        projectName || undefined,
      );

      // Local project with template: write .ants.json with agent config
      if (selectedProvider === 'local' && selectedTemplate && pathToUse && writeFile) {
        log.info('Applying local template config:', selectedTemplate.slug);
        try {
          const config: Record<string, unknown> = {};
          if (selectedTemplate.rootAgentType) {
            config.rootAgentType = selectedTemplate.rootAgentType;
          }
          if (selectedTemplate.agentTypes && selectedTemplate.agentTypes.length > 0) {
            config.agentTypes = selectedTemplate.agentTypes;
          }
          if (Object.keys(config).length > 0) {
            await writeFile(
              `${pathToUse}/.ants.json`,
              JSON.stringify(config, null, 2),
            );
            log.debug('Wrote .ants.json with template config');
          }
        } catch (e) {
          // Non-fatal: project was created, just couldn't apply template config
          log.warn('Failed to write template config:', e);
        }
      }

      onProjectCreated(project);
    } catch (e) {
      log.error('Failed to create project:', e);
      setError(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  // Expose actions to parent if requested
  // NOTE: handleCreateProject must be re-exposed whenever any of its captured
  // state changes (projectName, projectPath, effectivePath, etc.), otherwise
  // the parent holds a stale closure and the user-entered name is lost.
  useEffect(() => {
    log.debug('onReady effect: Updating parent with canCreate:', canCreate, 'projectName at this point:', JSON.stringify(projectName));
    onReady?.({ create: handleCreateProject, canCreate });
  }, [canCreate, projectName, projectPath, effectivePath, selectedProvider, useDefaultDirectory, createSubfolder, selectedTemplate]);

  const getPathDisplay = (path: string) => {
    if (!path) return '';
    if (path.length > 50) {
      return '...' + path.slice(-47);
    }
    return path;
  };

  const formContent = (
    <>
      {/* Template Selection */}
      <TemplateSelector
        selectedTemplate={selectedTemplate}
        onSelect={setSelectedTemplate}
        bridge={bridge}
        remoteServerId={selectedProvider !== 'local' ? selectedProvider : undefined}
      />

      {/* Project Name */}
      <Input
        label="Project Name (optional)"
        value={projectName}
        onChange={setProjectName}
        placeholder="My Project"
      />

      {/* Provider Selection */}
      <View style={styles.fieldGroup}>
        <Text variant="label" style={styles.fieldLabel}>
          Provider
        </Text>
        <Pressable
          style={[
            styles.selector,
            {
              backgroundColor: colors.bg.secondary,
              borderColor: colors.border.light,
            },
          ]}
          onPress={() => setShowProviderPicker(!showProviderPicker)}
        >
          <Text style={{ flex: 1 }}>{getProviderDisplayName()}</Text>
          <Icon
            name={showProviderPicker ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.text.muted}
          />
        </Pressable>

        {showProviderPicker && (
          <View
            style={[
              styles.dropdown,
              {
                backgroundColor: colors.bg.secondary,
                borderColor: colors.border.light,
              },
            ]}
          >
            <Pressable
              style={[
                styles.dropdownItem,
                { borderBottomColor: colors.border.light },
                selectedProvider === 'local' && {
                  backgroundColor: colors.bg.tertiary,
                },
              ]}
              onPress={() => handleSelectProvider('local')}
            >
              <Text>Local</Text>
              {selectedProvider === 'local' && (
                <Icon name="check" size={16} color={colors.primary} />
              )}
            </Pressable>

            {remoteServers.map((server) => (
              <Pressable
                key={server.id}
                style={[
                  styles.dropdownItem,
                  { borderBottomColor: colors.border.light },
                  selectedProvider === server.id && {
                    backgroundColor: colors.bg.tertiary,
                  },
                ]}
                onPress={() => handleSelectProvider(server.id)}
              >
                <Text>{server.name}</Text>
                {selectedProvider === server.id && (
                  <Icon name="check" size={16} color={colors.primary} />
                )}
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Working Directory - Local */}
      {selectedProvider === 'local' && (
        <View style={styles.fieldGroup}>
          <Text variant="label" style={styles.fieldLabel}>
            Working Directory
          </Text>

          {getDefaultProjectsDirectory && (
            <View
              style={[
                styles.toggleRow,
                {
                  backgroundColor: colors.bg.secondary,
                  borderColor: colors.border.light,
                },
              ]}
            >
              <View style={styles.toggleContent}>
                <Text>Use default location</Text>
                <Text variant="caption" color="muted">
                  {useDefaultDirectory
                    ? 'Project will be created in Ants Projects folder'
                    : 'Choose a custom folder location'}
                </Text>
              </View>
              <Switch
                value={useDefaultDirectory}
                onValueChange={setUseDefaultDirectory}
              />
            </View>
          )}

          {(!useDefaultDirectory || !getDefaultProjectsDirectory) && (
            <Pressable
              style={[
                styles.directorySelector,
                {
                  backgroundColor: colors.bg.secondary,
                  borderColor: colors.border.light,
                  marginTop: getDefaultProjectsDirectory ? spacing[3] : 0,
                },
              ]}
              onPress={handleBrowseDirectory}
            >
              <View style={styles.directoryContent}>
                {projectPath ? (
                  <>
                    <Icon name="folder" size={20} color={colors.primary} />
                    <Text style={{ flex: 1 }} numberOfLines={1}>
                      {getPathDisplay(projectPath)}
                    </Text>
                  </>
                ) : (
                  <>
                    <Icon name="folder" size={20} color={colors.text.muted} />
                    <Text color="muted" style={{ flex: 1 }}>
                      Select a folder...
                    </Text>
                  </>
                )}
              </View>
              <Icon name="chevron-right" size={18} color={colors.text.muted} />
            </Pressable>
          )}

          {effectivePath ? (
            <Text variant="caption" color="muted" style={styles.pathHint}>
              {useDefaultDirectory && getDefaultProjectsDirectory
                ? `Will create: ${getPathDisplay(effectivePath)}`
                : projectPath || 'No folder selected'}
            </Text>
          ) : null}
        </View>
      )}

      {/* Working Directory - Remote */}
      {selectedProvider !== 'local' && (
        <View style={styles.fieldGroup}>
          <Text variant="label" style={styles.fieldLabel}>
            Working Directory
          </Text>
          <Pressable
            style={[
              styles.directorySelector,
              {
                backgroundColor: colors.bg.secondary,
                borderColor: colors.border.light,
              },
            ]}
            onPress={handleBrowseDirectory}
          >
            <View style={styles.directoryContent}>
              {projectPath ? (
                <>
                  <Icon name="folder" size={20} color={colors.primary} />
                  <Text style={{ flex: 1 }} numberOfLines={1}>
                    {getPathDisplay(projectPath)}
                  </Text>
                </>
              ) : (
                <>
                  <Icon name="folder" size={20} color={colors.text.muted} />
                  <Text color="muted" style={{ flex: 1 }}>
                    Select a folder...
                  </Text>
                </>
              )}
            </View>
            <Icon name="chevron-right" size={18} color={colors.text.muted} />
          </Pressable>

          <View
            style={[
              styles.toggleRow,
              {
                backgroundColor: colors.bg.secondary,
                borderColor: colors.border.light,
                marginTop: spacing[3],
              },
            ]}
          >
            <View style={styles.toggleContent}>
              <Text>Create new subfolder</Text>
              <Text variant="caption" color="muted">
                {createSubfolder
                  ? 'A new folder will be created inside the selected directory'
                  : 'The selected directory will be used directly'}
              </Text>
            </View>
            <Switch
              value={createSubfolder}
              onValueChange={setCreateSubfolder}
            />
          </View>

          {effectivePath ? (
            <Text variant="caption" color="muted" style={styles.pathHint}>
              {createSubfolder && projectPath
                ? `Will create: ${getPathDisplay(effectivePath)}`
                : projectPath || 'No folder selected'}
            </Text>
          ) : null}
        </View>
      )}

      {/* Error message */}
      {error && (
        <View
          style={[
            styles.errorContainer,
            { backgroundColor: `${colors.error}15` },
          ]}
        >
          <Icon name="alert-circle" size={16} color={colors.error} />
          <Text
            style={{
              color: colors.error,
              flex: 1,
              marginLeft: spacing[2],
            }}
          >
            {error}
          </Text>
        </View>
      )}

      {/* Footer buttons */}
      {showFooter && (
        <View style={[styles.footer, { borderTopColor: colors.border.light }]}>
          <Button variant="ghost" onPress={onCancel} disabled={creating}>
            Cancel
          </Button>
          <Button testID="ants-create-project" variant="primary" onPress={handleCreateProject} disabled={!canCreate}>
            {creating ? 'Creating...' : 'Create Project'}
          </Button>
        </View>
      )}
    </>
  );

  return (
    <>
      {scrollable ? (
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.scrollContentInner}
        >
          {formContent}
        </ScrollView>
      ) : (
        <View style={styles.scrollContentInner}>{formContent}</View>
      )}

      {/* In-app DirectoryPicker modal (fallback when no native picker or browse callback) */}
      {filesystemProvider && !onBrowseDirectory && (
        <DirectoryPicker
          visible={showDirectoryPicker}
          onClose={() => setShowDirectoryPicker(false)}
          onSelect={handleDirectorySelected}
          provider={filesystemProvider}
          title="Select Working Directory"
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flex: 1,
  },
  scrollContentInner: {
    gap: spacing[1],
  },
  fieldGroup: {
    marginTop: spacing[4],
  },
  fieldLabel: {
    marginBottom: spacing[2],
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2] + 2,
  },
  dropdown: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    marginTop: spacing[2],
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2] + 2,
    borderBottomWidth: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2] + 2,
  },
  toggleContent: {
    flex: 1,
    marginRight: spacing[3],
  },
  directorySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2] + 2,
  },
  directoryContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  pathHint: {
    marginTop: spacing[2],
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    borderRadius: borderRadius.md,
    marginTop: spacing[4],
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    marginTop: spacing[4],
    paddingTop: spacing[4],
    borderTopWidth: 1,
  },
});
