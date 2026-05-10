import { describe, it, expect } from 'vitest';
import { mapMouseButton, getModifiers } from '../utils';

describe('mapMouseButton', () => {
  it('maps button 0 to left', () => {
    expect(mapMouseButton(0)).toBe('left');
  });

  it('maps button 1 to middle', () => {
    expect(mapMouseButton(1)).toBe('middle');
  });

  it('maps button 2 to right', () => {
    expect(mapMouseButton(2)).toBe('right');
  });

  it('maps unknown button to none', () => {
    expect(mapMouseButton(3)).toBe('none');
    expect(mapMouseButton(4)).toBe('none');
    expect(mapMouseButton(-1)).toBe('none');
  });
});

describe('getModifiers', () => {
  const noModifiers = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

  it('returns 0 when no modifiers are active', () => {
    expect(getModifiers(noModifiers)).toBe(0);
  });

  it('returns 1 for Alt', () => {
    expect(getModifiers({ ...noModifiers, altKey: true })).toBe(1);
  });

  it('returns 2 for Ctrl', () => {
    expect(getModifiers({ ...noModifiers, ctrlKey: true })).toBe(2);
  });

  it('returns 4 for Meta', () => {
    expect(getModifiers({ ...noModifiers, metaKey: true })).toBe(4);
  });

  it('returns 8 for Shift', () => {
    expect(getModifiers({ ...noModifiers, shiftKey: true })).toBe(8);
  });

  it('combines Alt + Shift', () => {
    expect(getModifiers({ ...noModifiers, altKey: true, shiftKey: true })).toBe(1 | 8);
  });

  it('combines Ctrl + Meta', () => {
    expect(getModifiers({ ...noModifiers, ctrlKey: true, metaKey: true })).toBe(2 | 4);
  });

  it('combines all modifiers', () => {
    expect(getModifiers({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(1 | 2 | 4 | 8);
  });

  it('returns correct bitmask for Alt + Ctrl + Shift (no Meta)', () => {
    expect(getModifiers({ altKey: true, ctrlKey: true, metaKey: false, shiftKey: true })).toBe(1 | 2 | 8);
  });
});
