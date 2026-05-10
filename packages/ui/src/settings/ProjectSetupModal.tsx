/**
 * ProjectSetupModal - Desktop-oriented modal wrapper around ProjectSetupForm.
 *
 * Renders the shared ProjectSetupForm inside a Modal dialog.
 * The Cancel/Create buttons live inside the scrollable form content so users
 * must scroll through all options before creating.
 * For full-screen usage (e.g. mobile), use ProjectSetupForm directly.
 */

import React, { useState, useEffect } from 'react';
import { Modal } from '../primitives/Modal';
import { ProjectSetupForm } from './ProjectSetupForm';
import type { FilesystemProvider } from '../primitives/DirectoryPicker';
import type { AgentBridge, Project } from '../agent/types';

export interface ProjectSetupModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when the modal is dismissed without creating a project */
  onClose: () => void;
  /** Called when a project is successfully created */
  onProjectCreated: (project: Project) => void;
  /** The agent bridge to use for project creation and server listing */
  bridge: AgentBridge;
  /** Platform-specific filesystem provider factory for local directory browsing */
  createLocalFilesystemProvider?: () => FilesystemProvider;
  /** Platform-specific function to get the default projects directory */
  getDefaultProjectsDirectory?: () => string;
  /** Platform-specific function to ensure a directory exists */
  ensureDirectoryExists?: (path: string) => void | Promise<void>;
  /** Optional: use the native OS directory picker */
  openNativeDirectoryPicker?: () => Promise<string | null>;
  /** Platform-specific function to write a file to disk (for template config) */
  writeFile?: (filePath: string, content: string) => void | Promise<void>;
}

export function ProjectSetupModal({
  visible,
  onClose,
  onProjectCreated,
  bridge,
  createLocalFilesystemProvider,
  getDefaultProjectsDirectory,
  ensureDirectoryExists,
  openNativeDirectoryPicker,
  writeFile,
}: ProjectSetupModalProps) {
  // Reset key forces ProjectSetupForm to remount and reset when modal opens
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (visible) {
      setResetKey((k) => k + 1);
    }
  }, [visible]);

  return (
    <Modal visible={visible} onClose={onClose} title="New Project">
      <ProjectSetupForm
        key={resetKey}
        bridge={bridge}
        onProjectCreated={onProjectCreated}
        onCancel={onClose}
        createLocalFilesystemProvider={createLocalFilesystemProvider}
        getDefaultProjectsDirectory={getDefaultProjectsDirectory}
        ensureDirectoryExists={ensureDirectoryExists}
        openNativeDirectoryPicker={openNativeDirectoryPicker}
        writeFile={writeFile}
        showFooter={true}
        scrollable={true}
      />
    </Modal>
  );
}
