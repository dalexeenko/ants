import { createContext, useContext } from 'react';
import { Appearance } from 'react-native';
import { colors, palette, type ThemeColors } from './tokens';

export type ThemeMode = 'light' | 'dark' | 'system';

/** Resolved theme object provided via ThemeContext. */
export interface Theme {
  mode: ThemeMode;
  resolvedMode: 'light' | 'dark';
  colors: ThemeColors & {
    // Semantic colors that are the same in both themes
    primary: string;
    primaryHover: string;
    primaryActive: string;
    success: string;
    warning: string;
    error: string;
    info: string;
  };
  /** Extended palette for one-off accent/variant needs (categories, toasts, etc.) */
  palette: typeof palette;
}

function getSystemTheme(): 'light' | 'dark' {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

export function resolveTheme(mode: ThemeMode): Theme {
  const resolvedMode = mode === 'system' ? getSystemTheme() : mode;
  const themeColors = resolvedMode === 'dark' ? colors.dark : colors.light;

  return {
    mode,
    resolvedMode,
    colors: {
      ...themeColors,
      // Add semantic colors that are the same in both themes
      primary: colors.primary,
      primaryHover: colors.primaryHover,
      primaryActive: colors.primaryActive,
      success: colors.success,
      warning: colors.warning,
      error: colors.error,
      info: colors.info,
    } as Theme['colors'],
    palette,
  };
}

const defaultTheme = resolveTheme('system');

export const ThemeContext = createContext<Theme>(defaultTheme);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export { colors, palette };
