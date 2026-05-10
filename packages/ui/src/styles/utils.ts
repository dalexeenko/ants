import { StyleSheet, Platform } from 'react-native';
import { spacing, fontSize, fontWeight, borderRadius } from './tokens';

/**
 * Returns true if the app is running on a touch-based mobile device (iOS/Android).
 * On these platforms, hover states don't exist, so we need alternative UI patterns.
 */
export const isTouchDevice = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * Returns true if the app is running on web.
 */
export const isWeb = Platform.OS === 'web';

// Flexbox utilities
export const flex = StyleSheet.create({
  row: { flexDirection: 'row' },
  col: { flexDirection: 'column' },
  wrap: { flexWrap: 'wrap' },
  '1': { flex: 1 },
  grow: { flexGrow: 1 },
  shrink: { flexShrink: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  itemsCenter: { alignItems: 'center' },
  itemsStart: { alignItems: 'flex-start' },
  itemsEnd: { alignItems: 'flex-end' },
  justifyCenter: { justifyContent: 'center' },
  justifyBetween: { justifyContent: 'space-between' },
  justifyEnd: { justifyContent: 'flex-end' },
  justifyStart: { justifyContent: 'flex-start' },
});

// Generate spacing utilities
function generateSpacingStyles<T extends string>(
  property: T
): Record<string, Record<T, number>> {
  return Object.fromEntries(
    Object.entries(spacing).map(([key, value]) => [key, { [property]: value }])
  ) as Record<string, Record<T, number>>;
}

// Padding utilities
export const p = generateSpacingStyles('padding');
export const px = Object.fromEntries(
  Object.entries(spacing).map(([k, v]) => [
    k,
    { paddingHorizontal: v },
  ])
) as Record<string, { paddingHorizontal: number }>;
export const py = Object.fromEntries(
  Object.entries(spacing).map(([k, v]) => [
    k,
    { paddingVertical: v },
  ])
) as Record<string, { paddingVertical: number }>;
export const pt = generateSpacingStyles('paddingTop');
export const pb = generateSpacingStyles('paddingBottom');
export const pl = generateSpacingStyles('paddingLeft');
export const pr = generateSpacingStyles('paddingRight');

// Margin utilities
export const m = generateSpacingStyles('margin');
export const mx = Object.fromEntries(
  Object.entries(spacing).map(([k, v]) => [
    k,
    { marginHorizontal: v },
  ])
) as Record<string, { marginHorizontal: number }>;
export const my = Object.fromEntries(
  Object.entries(spacing).map(([k, v]) => [
    k,
    { marginVertical: v },
  ])
) as Record<string, { marginVertical: number }>;
export const mt = generateSpacingStyles('marginTop');
export const mb = generateSpacingStyles('marginBottom');
export const ml = generateSpacingStyles('marginLeft');
export const mr = generateSpacingStyles('marginRight');

// Typography utilities
export const text = StyleSheet.create({
  xs: { fontSize: fontSize.xs },
  sm: { fontSize: fontSize.sm },
  base: { fontSize: fontSize.base },
  lg: { fontSize: fontSize.lg },
  xl: { fontSize: fontSize.xl },
  '2xl': { fontSize: fontSize['2xl'] },
  '3xl': { fontSize: fontSize['3xl'] },
  bold: { fontWeight: fontWeight.bold },
  semibold: { fontWeight: fontWeight.semibold },
  medium: { fontWeight: fontWeight.medium },
  normal: { fontWeight: fontWeight.normal },
  center: { textAlign: 'center' },
  left: { textAlign: 'left' },
  right: { textAlign: 'right' },
});

// Border radius utilities
export const rounded = StyleSheet.create({
  none: { borderRadius: borderRadius.none },
  sm: { borderRadius: borderRadius.sm },
  md: { borderRadius: borderRadius.md },
  lg: { borderRadius: borderRadius.lg },
  xl: { borderRadius: borderRadius.xl },
  full: { borderRadius: borderRadius.full },
});

// Size utilities
export const size = StyleSheet.create({
  full: { width: '100%', height: '100%' },
  screen: { flex: 1 },
});

// Helper to clamp a value between min and max
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Helper to generate a unique ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
