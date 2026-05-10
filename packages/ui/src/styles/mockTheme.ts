/**
 * Shared mock theme objects for tests.
 *
 * Instead of hardcoding hex values in every test file, import from here so
 * palette changes only need to be made in tokens.ts.
 *
 * Usage in a test file:
 *
 *   import { mockLightTheme } from '../styles/mockTheme';
 *
 *   vi.mock('../styles/theme', () => ({
 *     useTheme: () => mockLightTheme,
 *   }));
 *
 * Because vitest hoists vi.mock calls, the import of mockTheme must be a
 * static top-level import (which vitest keeps above the hoisted mock).
 * mockTheme.ts deliberately does NOT import from './theme' so there is no
 * circular-dependency issue with the mocked module.
 */

import { colors, palette } from './tokens';

/** Light-mode mock theme (full shape matching Theme interface). */
export const mockLightTheme = {
  mode: 'light' as const,
  resolvedMode: 'light' as const,
  colors: {
    ...colors.light,
    primary: colors.primary,
    primaryHover: colors.primaryHover,
    primaryActive: colors.primaryActive,
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    info: colors.info,
  },
  palette,
};

/** Dark-mode mock theme (full shape matching Theme interface). */
export const mockDarkTheme = {
  mode: 'dark' as const,
  resolvedMode: 'dark' as const,
  colors: {
    ...colors.dark,
    primary: colors.primary,
    primaryHover: colors.primaryHover,
    primaryActive: colors.primaryActive,
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    info: colors.info,
  },
  palette,
};
