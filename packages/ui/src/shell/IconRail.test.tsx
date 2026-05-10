import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { IconRail } from './IconRail';
import { useUIStore } from '../store/uiStore';

// Mock the theme module
vi.mock('../styles/theme', async () => {
  const React = await import('react');
  const { mockLightTheme } = await import('../styles/mockTheme');
  return {
    ThemeContext: React.createContext(mockLightTheme),
    useTheme: () => mockLightTheme,
  };
});

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

// Mock IconButton to simplify rendering
vi.mock('../primitives/IconButton', () => ({
  IconButton: ({ testID, onPress, icon }: any) => (
    <button data-testid={testID} onClick={onPress}>{icon}</button>
  ),
}));

describe('IconRail', () => {
  beforeEach(() => {
    useUIStore.setState({
      activeScreen: 'project',
      leftSidebarCollapsed: false,
    });
  });

  it('renders the icon rail with testID', () => {
    render(<IconRail />);
    expect(screen.getByTestId('ants-icon-rail')).toBeInTheDocument();
  });

  it('renders project, director, agents, and settings icons', () => {
    render(<IconRail />);
    expect(screen.getByTestId('ants-icon-rail-projects')).toBeInTheDocument();
    expect(screen.getByTestId('ants-icon-rail-director')).toBeInTheDocument();
    expect(screen.getByTestId('ants-icon-rail-agents')).toBeInTheDocument();
    expect(screen.getByTestId('ants-icon-rail-settings')).toBeInTheDocument();
  });

  it('switches active screen when clicking a different icon', () => {
    render(<IconRail />);

    fireEvent.click(screen.getByTestId('ants-icon-rail-settings'));
    expect(useUIStore.getState().activeScreen).toBe('settings');
  });

  it('toggles sidebar when clicking the already active screen icon', () => {
    useUIStore.setState({ activeScreen: 'project', leftSidebarCollapsed: false });

    render(<IconRail />);

    fireEvent.click(screen.getByTestId('ants-icon-rail-projects'));
    expect(useUIStore.getState().leftSidebarCollapsed).toBe(true);
  });

  it('expands sidebar and switches screen when clicking different icon while collapsed', () => {
    useUIStore.setState({ activeScreen: 'project', leftSidebarCollapsed: true });

    render(<IconRail />);

    fireEvent.click(screen.getByTestId('ants-icon-rail-director'));
    expect(useUIStore.getState().activeScreen).toBe('director');
    expect(useUIStore.getState().leftSidebarCollapsed).toBe(false);
  });
});
