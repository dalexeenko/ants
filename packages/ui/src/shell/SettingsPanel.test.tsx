import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SettingsPanel } from './SettingsPanel';
import { useUIStore } from '../store/uiStore';
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

// Mock child components
vi.mock('../settings/ThemeSettings', () => ({
  ThemeSettings: () => <div data-testid="theme-settings">Theme Settings</div>,
}));

vi.mock('../settings/AuthenticationSection', () => ({
  AuthenticationSection: () => <div data-testid="auth-section">Auth Section</div>,
}));

vi.mock('../settings/RemoteServersSection', () => ({
  RemoteServersSection: () => <div data-testid="remote-servers-section">Remote Servers</div>,
}));

vi.mock('../plugins', () => ({
  usePluginSettingsSections: () => [],
  usePluginScreens: () => [],
  usePluginMiddleTabs: () => [],
  usePluginSidebarPanels: () => [],
  UIPluginRegistry: class { registerAuthProvider() {} },
  UIPluginProvider: ({ children }: any) => children,
  cloudflareAccessAuthProvider: {},
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('SettingsPanel', () => {
  let originalAgentBridge: any;

  beforeEach(() => {
    originalAgentBridge = window.agentBridge;
    window.agentBridge = {} as any;

    useUIStore.setState({
      view: 'settings',
      activeScreen: 'settings',
    });
    useProjectStore.setState({
      currentProjectId: null,
    });
  });

  afterEach(() => {
    window.agentBridge = originalAgentBridge;
  });

  it('renders the settings panel with testID', () => {
    render(<SettingsPanel />);
    expect(screen.getByTestId('openmgr-settings-panel')).toBeInTheDocument();
  });

  it('renders Settings heading', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('always renders ThemeSettings', () => {
    render(<SettingsPanel />);
    expect(screen.getByTestId('theme-settings')).toBeInTheDocument();
  });

  it('renders AuthenticationSection on desktop platform', () => {
    const adapter: PlatformAdapter = { platform: 'desktop' };

    render(
      <PlatformProvider adapter={adapter}>
        <SettingsPanel />
      </PlatformProvider>
    );

    expect(screen.getByTestId('auth-section')).toBeInTheDocument();
  });

  it('hides AuthenticationSection on web platform', () => {
    const adapter: PlatformAdapter = { platform: 'web' };

    render(
      <PlatformProvider adapter={adapter}>
        <SettingsPanel />
      </PlatformProvider>
    );

    expect(screen.queryByTestId('auth-section')).not.toBeInTheDocument();
  });

  it('renders RemoteServersSection when bridge is available', () => {
    render(<SettingsPanel />);
    expect(screen.getByTestId('remote-servers-section')).toBeInTheDocument();
  });

});
