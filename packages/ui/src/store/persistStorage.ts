/**
 * Configurable storage adapter for zustand persist middleware.
 *
 * On web/desktop, zustand defaults to localStorage which works fine.
 * On React Native, localStorage doesn't exist — call `setPersistStorage()`
 * with an AsyncStorage-backed adapter before any stores are created.
 */
import type { PersistStorage } from 'zustand/middleware';

let customStorage: PersistStorage<any> | undefined;

/**
 * Set a custom storage adapter for zustand persistence.
 * Must be called before any zustand stores are created (e.g., at app startup).
 */
export function setPersistStorage(storage: PersistStorage<any>): void {
  customStorage = storage;
}

/**
 * Get the configured storage adapter, or undefined to use zustand's default (localStorage).
 */
export function getPersistStorage(): PersistStorage<any> | undefined {
  return customStorage;
}
