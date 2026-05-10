import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectSection } from './ProjectSection';
import { mockLightTheme } from '../styles/mockTheme';
import type { Project } from '../agent/types';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

// Mock isTouchDevice
vi.mock('../styles/utils', () => ({
  isTouchDevice: false,
}));

const baseProject: Project = {
  id: 'project-1',
  name: 'Test Project',
  path: '/path/to/project',
  createdAt: Date.now(),
  providerType: 'local',
};

const noop = () => {};

describe('ProjectSection', () => {
  describe('worktree button visibility', () => {
    it('should show worktree button when isGitRepo and worktreeEnabled and callback provided', () => {
      const project: Project = { ...baseProject, isGitRepo: true, worktreeEnabled: true };
      render(
        <ProjectSection
          project={project}
          sessions={[]}
          onToggleExpand={noop}
          onNewSession={noop}
          onSelectSession={noop}
          onNewWorktreeSession={noop}
        />
      );

      expect(screen.getByTestId('ants-project-new-worktree-session')).toBeInTheDocument();
    });

    it('should NOT show worktree button when isGitRepo is false', () => {
      const project: Project = { ...baseProject, isGitRepo: false, worktreeEnabled: true };
      render(
        <ProjectSection
          project={project}
          sessions={[]}
          onToggleExpand={noop}
          onNewSession={noop}
          onSelectSession={noop}
          onNewWorktreeSession={noop}
        />
      );

      expect(screen.queryByTestId('ants-project-new-worktree-session')).not.toBeInTheDocument();
    });

    it('should NOT show worktree button when worktreeEnabled is false', () => {
      const project: Project = { ...baseProject, isGitRepo: true, worktreeEnabled: false };
      render(
        <ProjectSection
          project={project}
          sessions={[]}
          onToggleExpand={noop}
          onNewSession={noop}
          onSelectSession={noop}
          onNewWorktreeSession={noop}
        />
      );

      expect(screen.queryByTestId('ants-project-new-worktree-session')).not.toBeInTheDocument();
    });

    it('should NOT show worktree button when worktreeEnabled is undefined', () => {
      const project: Project = { ...baseProject, isGitRepo: true };
      render(
        <ProjectSection
          project={project}
          sessions={[]}
          onToggleExpand={noop}
          onNewSession={noop}
          onSelectSession={noop}
          onNewWorktreeSession={noop}
        />
      );

      expect(screen.queryByTestId('ants-project-new-worktree-session')).not.toBeInTheDocument();
    });

    it('should NOT show worktree button when isGitRepo is undefined', () => {
      const project: Project = { ...baseProject, worktreeEnabled: true };
      render(
        <ProjectSection
          project={project}
          sessions={[]}
          onToggleExpand={noop}
          onNewSession={noop}
          onSelectSession={noop}
          onNewWorktreeSession={noop}
        />
      );

      expect(screen.queryByTestId('ants-project-new-worktree-session')).not.toBeInTheDocument();
    });

    it('should NOT show worktree button when callback is not provided', () => {
      const project: Project = { ...baseProject, isGitRepo: true, worktreeEnabled: true };
      render(
        <ProjectSection
          project={project}
          sessions={[]}
          onToggleExpand={noop}
          onNewSession={noop}
          onSelectSession={noop}
        />
      );

      expect(screen.queryByTestId('ants-project-new-worktree-session')).not.toBeInTheDocument();
    });
  });
});
