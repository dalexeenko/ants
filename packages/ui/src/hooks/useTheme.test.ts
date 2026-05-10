import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThemeMode } from './useTheme';
import { useUIStore } from '../store/uiStore';

// Mock the Appearance module for system theme detection
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    Appearance: {
      getColorScheme: vi.fn(() => 'light'),
    },
  };
});

describe('useThemeMode', () => {
  beforeEach(() => {
    // Reset store state before each test
    useUIStore.setState({
      themeMode: 'system',
    });
  });

  it('should return the current theme mode from the store', () => {
    const { result } = renderHook(() => useThemeMode());

    expect(result.current.themeMode).toBe('system');
  });

  it('should return setThemeMode function', () => {
    const { result } = renderHook(() => useThemeMode());

    expect(typeof result.current.setThemeMode).toBe('function');
  });

  it('should return a resolved theme object', () => {
    const { result } = renderHook(() => useThemeMode());

    expect(result.current.theme).toBeDefined();
    expect(result.current.theme.mode).toBe('system');
    expect(result.current.theme.resolvedMode).toBeDefined();
    expect(result.current.theme.colors).toBeDefined();
  });

  it('should update theme when themeMode changes to dark', () => {
    const { result } = renderHook(() => useThemeMode());

    act(() => {
      result.current.setThemeMode('dark');
    });

    expect(result.current.themeMode).toBe('dark');
    expect(result.current.theme.mode).toBe('dark');
    expect(result.current.theme.resolvedMode).toBe('dark');
  });

  it('should update theme when themeMode changes to light', () => {
    useUIStore.setState({ themeMode: 'dark' });
    const { result } = renderHook(() => useThemeMode());

    act(() => {
      result.current.setThemeMode('light');
    });

    expect(result.current.themeMode).toBe('light');
    expect(result.current.theme.mode).toBe('light');
    expect(result.current.theme.resolvedMode).toBe('light');
  });

  it('should include semantic colors in theme', () => {
    const { result } = renderHook(() => useThemeMode());

    expect(result.current.theme.colors.primary).toBeDefined();
    expect(result.current.theme.colors.primaryHover).toBeDefined();
    expect(result.current.theme.colors.primaryActive).toBeDefined();
    expect(result.current.theme.colors.success).toBeDefined();
    expect(result.current.theme.colors.warning).toBeDefined();
    expect(result.current.theme.colors.error).toBeDefined();
    expect(result.current.theme.colors.info).toBeDefined();
  });

  it('should include theme-specific colors', () => {
    const { result } = renderHook(() => useThemeMode());

    expect(result.current.theme.colors.bg).toBeDefined();
    expect(result.current.theme.colors.bg.primary).toBeDefined();
    expect(result.current.theme.colors.text).toBeDefined();
    expect(result.current.theme.colors.text.secondary).toBeDefined();
    expect(result.current.theme.colors.border).toBeDefined();
  });

  it('should memoize theme object when themeMode does not change', () => {
    const { result, rerender } = renderHook(() => useThemeMode());

    const firstTheme = result.current.theme;
    rerender();
    const secondTheme = result.current.theme;

    expect(firstTheme).toBe(secondTheme);
  });

  it('should return different theme when themeMode changes', () => {
    const { result } = renderHook(() => useThemeMode());

    const lightTheme = result.current.theme;

    act(() => {
      result.current.setThemeMode('dark');
    });

    const darkTheme = result.current.theme;

    expect(lightTheme).not.toBe(darkTheme);
    expect(lightTheme.resolvedMode).not.toBe(darkTheme.resolvedMode);
  });
});
