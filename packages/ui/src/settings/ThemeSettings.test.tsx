import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeSettings } from './ThemeSettings';
import { useUIStore } from '../store/uiStore';
import { mockLightTheme } from '../styles/mockTheme';

// Mock useTheme
vi.mock('../styles/theme', () => ({
  useTheme: () => mockLightTheme,
}));

describe('ThemeSettings', () => {
  beforeEach(() => {
    useUIStore.setState({ themeMode: 'system' });
  });

  it('should render theme options', () => {
    render(<ThemeSettings />);

    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
  });

  it('should render section title and description', () => {
    render(<ThemeSettings />);

    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Choose how OpenMgr looks on your device')).toBeInTheDocument();
  });

  it('should render descriptions for each option', () => {
    render(<ThemeSettings />);

    expect(screen.getByText('Follow your system settings')).toBeInTheDocument();
    expect(screen.getByText('Always use light theme')).toBeInTheDocument();
    expect(screen.getByText('Always use dark theme')).toBeInTheDocument();
  });

  it('should update theme mode to dark when dark option is clicked', () => {
    render(<ThemeSettings />);

    // Click on the Dark label text - the click will bubble up to the Pressable
    fireEvent.click(screen.getByText('Dark'));

    expect(useUIStore.getState().themeMode).toBe('dark');
  });

  it('should update theme mode to light when light option is clicked', () => {
    render(<ThemeSettings />);

    fireEvent.click(screen.getByText('Light'));

    expect(useUIStore.getState().themeMode).toBe('light');
  });

  it('should update theme mode to system when system option is clicked', () => {
    // Start with dark theme
    useUIStore.setState({ themeMode: 'dark' });

    render(<ThemeSettings />);

    fireEvent.click(screen.getByText('System'));

    expect(useUIStore.getState().themeMode).toBe('system');
  });

  it('should show all three theme options', () => {
    render(<ThemeSettings />);

    const options = ['System', 'Light', 'Dark'];
    options.forEach((option) => {
      expect(screen.getByText(option)).toBeInTheDocument();
    });
  });

  it('should maintain current selection after re-render', () => {
    const { rerender } = render(<ThemeSettings />);

    fireEvent.click(screen.getByText('Dark'));
    expect(useUIStore.getState().themeMode).toBe('dark');

    rerender(<ThemeSettings />);

    // Theme mode should still be dark
    expect(useUIStore.getState().themeMode).toBe('dark');
  });
});
