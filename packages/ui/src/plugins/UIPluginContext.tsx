/**
 * UIPluginContext — React context and hooks for accessing the UI plugin registry.
 *
 * Uses useSyncExternalStore to subscribe to registry changes so that
 * components re-render when plugins are registered/unregistered.
 */

import React, { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { UIPluginRegistry } from './UIPluginRegistry';
import type {
  TypedMiddleTabContribution,
  TypedSidebarPanelContribution,
  TypedSettingsSectionContribution,
  TypedScreenContribution,
  TypedToolRendererContribution,
  TypedChatDecoratorContribution,
  TypedAuthProviderContribution,
} from './types';

// Default registry instance (empty — plugins register at runtime)
const defaultRegistry = new UIPluginRegistry();

const UIPluginContext = createContext<UIPluginRegistry>(defaultRegistry);

// ============================================================================
// Provider
// ============================================================================

export interface UIPluginProviderProps {
  registry: UIPluginRegistry;
  children: ReactNode;
}

export function UIPluginProvider({ registry, children }: UIPluginProviderProps) {
  return (
    <UIPluginContext.Provider value={registry}>
      {children}
    </UIPluginContext.Provider>
  );
}

// ============================================================================
// Core Hook
// ============================================================================

/** Get the raw UIPluginRegistry instance */
export function useUIPluginRegistry(): UIPluginRegistry {
  return useContext(UIPluginContext);
}

// ============================================================================
// Helper: subscribe to registry version changes
// ============================================================================

function useRegistryVersion(registry: UIPluginRegistry): number {
  return useSyncExternalStore(
    (callback) => registry.subscribe(callback),
    () => registry.getVersion(),
    () => registry.getVersion(),
  );
}

// ============================================================================
// Extension Point Hooks
// ============================================================================

/** Get all plugin-contributed middle tab types */
export function usePluginMiddleTabs(): TypedMiddleTabContribution[] {
  const registry = useContext(UIPluginContext);
  useRegistryVersion(registry);
  return registry.getMiddleTabs();
}

/** Get all plugin-contributed sidebar panels, sorted by order */
export function usePluginSidebarPanels(): TypedSidebarPanelContribution[] {
  const registry = useContext(UIPluginContext);
  useRegistryVersion(registry);
  return registry.getSidebarPanels();
}

/** Get plugin-contributed settings sections for a given scope, sorted by order */
export function usePluginSettingsSections(scope: 'global' | 'project'): TypedSettingsSectionContribution[] {
  const registry = useContext(UIPluginContext);
  useRegistryVersion(registry);
  return registry.getSettingsSections(scope);
}

/** Get all plugin-contributed screens, sorted by order */
export function usePluginScreens(): TypedScreenContribution[] {
  const registry = useContext(UIPluginContext);
  useRegistryVersion(registry);
  return registry.getScreens();
}

/** Get a custom tool renderer for a specific tool name, or null */
export function usePluginToolRenderer(toolName: string): TypedToolRendererContribution | null {
  const registry = useContext(UIPluginContext);
  useRegistryVersion(registry);
  return registry.getToolRenderer(toolName) ?? null;
}

/** Get all plugin-contributed chat decorators for a position */
export function usePluginChatDecorators(position: 'before' | 'after' | 'wrap'): TypedChatDecoratorContribution[] {
  const registry = useContext(UIPluginContext);
  useRegistryVersion(registry);
  return registry.getChatDecorators(position);
}

/** Get all plugin-contributed auth providers */
export function usePluginAuthProviders(): TypedAuthProviderContribution[] {
  const registry = useContext(UIPluginContext);
  useRegistryVersion(registry);
  return registry.getAuthProviders();
}

/** Get a specific plugin-contributed auth provider by ID */
export function usePluginAuthProvider(id: string): TypedAuthProviderContribution | undefined {
  const registry = useContext(UIPluginContext);
  useRegistryVersion(registry);
  return registry.getAuthProvider(id);
}
