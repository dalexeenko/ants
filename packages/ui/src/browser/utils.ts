/**
 * Utility functions for browser streaming.
 */

/**
 * Maps DOM mouse button numbers to CDP button names.
 * DOM: 0=left, 1=middle, 2=right
 * CDP: 'left' | 'right' | 'middle' | 'none'
 */
export function mapMouseButton(button: number): 'left' | 'right' | 'middle' | 'none' {
  switch (button) {
    case 0: return 'left';
    case 1: return 'middle';
    case 2: return 'right';
    default: return 'none';
  }
}

/**
 * Build CDP modifier bitmask from DOM keyboard event modifiers.
 * CDP modifiers: 1=Alt, 2=Ctrl, 4=Meta, 8=Shift
 */
export function getModifiers(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  let m = 0;
  if (e.altKey) m |= 1;
  if (e.ctrlKey) m |= 2;
  if (e.metaKey) m |= 4;
  if (e.shiftKey) m |= 8;
  return m;
}
