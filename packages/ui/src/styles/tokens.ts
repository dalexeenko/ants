// Design tokens for OpenMgr UI
// This file is the single source of truth for all colors across the project.
// See packages/ui/AGENTS.md for documentation on the palette and usage guidelines.
import { Platform, type ViewStyle } from 'react-native';

// ── Raw Palette ──────────────────────────────────────────────────────
// Gray-green scale (dark mode foundation, with a subtle green tinge)
const grayGreen = {
  950: '#1A1F1A', // darkest
  900: '#272E27', // primary dark background
  800: '#343C34', // secondary dark background
  700: '#475047', // elevated/tertiary dark background
  600: '#5C665C', // heavy borders, muted text (dark)
  500: '#748074', // muted text (dark)
  400: '#95A095', // secondary text (dark)
  300: '#B5BDB5', // secondary text (light)
  200: '#D4DAD4', // borders (light)
  100: '#E8ECE8', // elevated/tertiary light background
  50: '#F5F7F5', // secondary light background
} as const;

// Neutral scale (for light mode text/borders that need no tinge)
const neutral = {
  900: '#111816', // primary text (light)
  700: '#3D4A47', // secondary text (light)
  500: '#6B7A76', // muted text (light)
  white: '#FFFFFF',
} as const;

// ── Semantic Colors ──────────────────────────────────────────────────
// Medium-chroma palette — hues carry enough saturation to feel vibrant
// on buttons, badges, and status indicators while still sitting
// comfortably against the gray-green surfaces.
export const palette = {
  // Brand (vivid blue)
  primary: '#4A62C0',       // rgb(74, 98, 192)
  primaryHover: '#3D53AD',  // darker
  primaryActive: '#324496', // darkest
  primaryMuted: '#283060',  // toast/banner bg

  // Status – success (vivid emerald-green)
  success: '#38A868',        // rgb(56, 168, 104)
  successHover: '#2D9256',   // darker
  successMuted: '#1A4A2E',   // toast/banner bg
  successLight: '#C8EDDA',   // light theme bg

  // Status – warning (vivid amber)
  warning: '#CC9524',        // rgb(204, 149, 36)
  warningHover: '#B0801A',   // darker
  warningMuted: '#564218',   // toast/banner bg
  warningLight: '#F0E2C0',   // light theme bg
  warningDark: '#8A6420',    // icon on light bg

  // Status – error (vivid red)
  error: '#CC4A4A',          // rgb(204, 74, 74)
  errorHover: '#B03636',     // darker
  errorMuted: '#581E1E',     // toast/banner bg
  errorLight: '#F0D2D2',     // light theme bg

  info: '#4A62C0',           // same as primary

  // Accent colors for categories/visualizations
  violet: '#8468C8',    // vivid violet
  indigo: '#626EC0',    // vivid indigo
  pink: '#C45A88',      // vivid pink
  teal: '#30A89A',      // vivid teal
  orange: '#CC7840',    // vivid orange
  yellow: '#B09830',    // vivid yellow
  green: '#48B858',     // vivid green (distinct from success)
  greenDark: '#36A044', // vivid green darker

  // Utility
  black: '#000000',
  white: '#FFFFFF',
  link: '#6AB4D6',      // vivid sky blue (links on dark backgrounds)
} as const;

// ── Theme Colors ─────────────────────────────────────────────────────
export const colors = {
  // Primary brand
  primary: palette.primary,
  primaryHover: palette.primaryHover,
  primaryActive: palette.primaryActive,

  // Semantic
  success: palette.success,
  warning: palette.warning,
  error: palette.error,
  info: palette.info,

  // Light theme
  light: {
    bg: {
      primary: neutral.white,
      secondary: grayGreen[50],
      tertiary: grayGreen[100],
      elevated: neutral.white,
    },
    text: {
      primary: neutral[900],
      secondary: neutral[700],
      muted: neutral[500],
      inverse: neutral.white,
    },
    border: {
      light: grayGreen[200],
      medium: grayGreen[300],
      heavy: neutral[500],
    },
  },

  // Dark theme
  dark: {
    bg: {
      primary: grayGreen[900],
      secondary: grayGreen[800],
      tertiary: grayGreen[700],
      elevated: grayGreen[800],
    },
    text: {
      primary: grayGreen[50],
      secondary: grayGreen[400],
      muted: grayGreen[500],
      inverse: grayGreen[900],
    },
    border: {
      light: grayGreen[700],
      medium: grayGreen[600],
      heavy: grayGreen[500],
    },
  },
};

export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

// Desktop (web/electron) uses a smaller type scale than mobile
const isDesktop = Platform.OS === 'web';

export const fontSize = isDesktop ? {
  xs: 11,
  sm: 12,
  base: 13,
  lg: 15,
  xl: 17,
  '2xl': 21,
  '3xl': 26,
} as const : {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
} as const;

export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const borderRadius = {
  none: 0,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
} as const;

const isWeb = typeof Platform !== 'undefined' && Platform.OS === 'web';

export const shadows: Record<'sm' | 'md' | 'lg', ViewStyle> = {
  sm: isWeb
    ? ({ boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.05)' } as ViewStyle)
    : {
        shadowColor: palette.black,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
      },
  md: isWeb
    ? ({ boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.1)' } as ViewStyle)
    : {
        shadowColor: palette.black,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 6,
        elevation: 3,
      },
  lg: isWeb
    ? ({ boxShadow: '0px 10px 15px rgba(0, 0, 0, 0.15)' } as ViewStyle)
    : {
        shadowColor: palette.black,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 15,
        elevation: 5,
      },
};

export type ThemeColors = typeof colors.light;
export type SpacingKey = keyof typeof spacing;
export type FontSizeKey = keyof typeof fontSize;
export type FontWeightKey = keyof typeof fontWeight;
export type BorderRadiusKey = keyof typeof borderRadius;
export type ShadowKey = keyof typeof shadows;
