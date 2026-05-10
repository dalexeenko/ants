/**
 * Polyfills for React Native
 * 
 * This file provides browser APIs that some dependencies expect but
 * aren't available in React Native's JavaScript runtime.
 * 
 * Must be imported BEFORE any other imports in the app entry point.
 */

// Type definitions for event handler
type EventListenerFn = (event: unknown) => void;

// Polyfill Event constructor (used by some streaming libraries)
if (typeof globalThis.Event === 'undefined') {
  // @ts-expect-error - Polyfilling global
  globalThis.Event = class Event {
    type: string;
    bubbles: boolean;
    cancelable: boolean;
    defaultPrevented: boolean;
    timeStamp: number;
    
    constructor(type: string, options?: { bubbles?: boolean; cancelable?: boolean }) {
      this.type = type;
      this.bubbles = options?.bubbles ?? false;
      this.cancelable = options?.cancelable ?? false;
      this.defaultPrevented = false;
      this.timeStamp = Date.now();
    }
    
    preventDefault() {
      if (this.cancelable) {
        this.defaultPrevented = true;
      }
    }
    
    stopPropagation() {}
    stopImmediatePropagation() {}
  };
}

// Polyfill CustomEvent (extends Event)
if (typeof globalThis.CustomEvent === 'undefined') {
  // @ts-expect-error - Polyfilling global
  globalThis.CustomEvent = class CustomEvent extends (globalThis.Event as typeof Event) {
    detail: unknown;
    
    constructor(type: string, options?: { bubbles?: boolean; cancelable?: boolean; detail?: unknown }) {
      super(type, options);
      this.detail = options?.detail ?? null;
    }
  };
}

// Polyfill EventTarget (used by some streaming/SSE libraries)
if (typeof globalThis.EventTarget === 'undefined') {
  (globalThis as Record<string, unknown>).EventTarget = class EventTargetPolyfill {
    private listeners: Map<string, Set<EventListenerFn>> = new Map();
    
    addEventListener(type: string, listener: EventListenerFn) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set());
      }
      this.listeners.get(type)!.add(listener);
    }
    
    removeEventListener(type: string, listener: EventListenerFn) {
      this.listeners.get(type)?.delete(listener);
    }
    
    dispatchEvent(event: Event): boolean {
      const listeners = this.listeners.get(event.type);
      if (listeners) {
        for (const listener of listeners) {
          listener.call(this, event);
        }
      }
      return !event.defaultPrevented;
    }
  };
}

// NOTE: We intentionally do NOT polyfill fetch globally.
// expo/fetch must be passed explicitly to functions that need streaming support.
// The react-native-polyfill-globals ReadableStream polyfill conflicts with expo/fetch.

export {};
