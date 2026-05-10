import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { WelcomeScreen } from './WelcomeScreen';
import { useProjectStore } from '../store/projectStore';
import { PlatformProvider, type PlatformAdapter } from '../platform/PlatformContext';

// Mock the theme module
vi.mock('../styles/theme', async () => {
  const React = await import('react');
  const { mockLightTheme } = await import('../styles/mockTheme');
  return {
    ThemeContext: React.createContext(mockLightTheme),
    useTheme: () => mockLightTheme,
  };
});

// Mock AuthenticationSection  
vi.mock('../settings/AuthenticationSection', () => ({
  AuthenticationSection: () => <div data-testid="auth-section">Auth</div>,
}));

// Mock ProjectSetupModal
vi.mock('../project/ProjectSetupModal', () => ({
  ProjectSetupModal: ({ visible, onClose }: any) =>
    visible ? <div data-testid="project-setup-modal"><button onClick={onClose}>Close</button></div> : null,
}));

// Mock Card
vi.mock('../primitives/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

// Mock plugins
vi.mock('../plugins', () => ({
  usePluginScreens: () => [],
  usePluginMiddleTabs: () => [],
  usePluginSettingsSections: () => [],
  usePluginSidebarPanels: () => [],
  UIPluginRegistry: class { registerAuthProvider() {} },
  UIPluginProvider: ({ children }: any) => children,
  cloudflareAccessAuthProvider: {},
}));

describe('WelcomeScreen', () => {
  let originalAgentBridge: any;

  beforeEach(() => {
    originalAgentBridge = window.agentBridge;
    window.agentBridge = {} as any;

    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
    });
  });

  afterEach(() => {
    window.agentBridge = originalAgentBridge;
  });

  it('renders the welcome screen with testID', () => {
    render(<WelcomeScreen />);
    expect(screen.getByTestId('ants-welcome-screen')).toBeInTheDocument();
  });

  it('renders welcome text', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('Welcome to Ants')).toBeInTheDocument();
    expect(screen.getByText('Your AI-powered project assistant')).toBeInTheDocument();
  });

  it('renders the New Project button', () => {
    render(<WelcomeScreen />);
    expect(screen.getByTestId('ants-welcome-new-project')).toBeInTheDocument();
  });

  it('shows AuthenticationSection on desktop platform', () => {
    const adapter: PlatformAdapter = { platform: 'desktop' };

    render(
      <PlatformProvider adapter={adapter}>
        <WelcomeScreen />
      </PlatformProvider>
    );

    expect(screen.getByTestId('auth-section')).toBeInTheDocument();
  });

  it('hides AuthenticationSection on web platform', () => {
    const adapter: PlatformAdapter = { platform: 'web' };

    render(
      <PlatformProvider adapter={adapter}>
        <WelcomeScreen />
      </PlatformProvider>
    );

    expect(screen.queryByTestId('auth-section')).not.toBeInTheDocument();
  });

  it('renders New Project button that is clickable', () => {
    render(<WelcomeScreen />);

    const button = screen.getByTestId('ants-welcome-new-project');
    expect(button).toBeInTheDocument();
    // Verify it contains the expected text
    expect(button).toHaveTextContent('New Project');
  });
});
