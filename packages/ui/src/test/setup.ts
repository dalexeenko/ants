/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';

// Mock react-native-web modules that might not be fully compatible
// These are available in jsdom environment at runtime
const win = globalThis as any;

if (win.window) {
  Object.defineProperty(win.window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Mock ResizeObserver
win.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
