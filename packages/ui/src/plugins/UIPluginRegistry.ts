/**
 * UIPluginRegistry — Runtime registry for UI plugin contributions.
 *
 * Collects UI contributions from all registered plugins and provides
 * sorted, typed accessors for each extension point. Supports subscription
 * for React integration via useSyncExternalStore.
 */

import type {
  TypedMiddleTabContribution,
  TypedSidebarPanelContribution,
  TypedSettingsSectionContribution,
  TypedScreenContribution,
  TypedToolRendererContribution,
  TypedChatDecoratorContribution,
  TypedAuthProviderContribution,
  AuthProviderHeadersFn,
} from './types';
import { createLogger } from '../utils/logger';

const log = createLogger('UIPluginRegistry');

/**
 * Local structural equivalent of UIPluginContributions from @openmgr/agent-core.
 * Defined here so the UI package doesn't need a dependency on agent-core.
 * All component fields are `unknown` — the registry narrows them when accessed via getters.
 */
interface UIPluginContributions {
  middleTabs?: Array<{ type: string; label: string; icon: string; component: unknown; showInNewTabMenu?: boolean }>;
  sidebarPanels?: Array<{ id: string; label: string; icon?: string; component: unknown; order?: number }>;
  settingsSections?: Array<{ id: string; label: string; description?: string; component: unknown; scope: 'global' | 'project' | 'both'; order?: number }>;
  screens?: Array<{ id: string; label: string; icon: string; component: unknown; order?: number }>;
  toolRenderers?: Array<{ toolNames: string[]; component: unknown }>;
  chatDecorators?: Array<{ id: string; position: 'before' | 'after' | 'wrap'; filter?: (message: unknown) => boolean; component: unknown }>;
  authProviders?: Array<{ id: string; label: string; icon?: string; connectionComponent: unknown; settingsComponent: unknown; getAuthHeaders?: unknown }>;
}

interface PluginEntry {
  pluginName: string;
  ui: UIPluginContributions;
}

export class UIPluginRegistry {
  private plugins: Map<string, PluginEntry> = new Map();
  private listeners: Set<() => void> = new Set();
  private version = 0;

  /**
   * Register UI contributions from a plugin.
   * If a plugin with the same name is already registered, it is replaced.
   */
  register(pluginName: string, contributions: UIPluginContributions): void {
    log.info(`Registering UI contributions from plugin: ${pluginName}`);
    this.plugins.set(pluginName, { pluginName, ui: contributions });
    this.notify();
  }

  /**
   * Unregister all UI contributions from a plugin.
   */
  unregister(pluginName: string): void {
    if (this.plugins.delete(pluginName)) {
      log.info(`Unregistered UI contributions from plugin: ${pluginName}`);
      this.notify();
    }
  }

  // ========== Getters ==========

  getMiddleTabs(): TypedMiddleTabContribution[] {
    const result: TypedMiddleTabContribution[] = [];
    for (const { pluginName, ui } of this.plugins.values()) {
      if (ui.middleTabs) {
        for (const tab of ui.middleTabs) {
          result.push({
            ...tab,
            // Narrow unknown -> ComponentType. The actual runtime type is a React component
            // provided by the plugin. This cast is safe because the plugin author imports
            // the typed interfaces from @openmgr/ui/plugins.
            component: tab.component as TypedMiddleTabContribution['component'],
            pluginName,
          });
        }
      }
    }
    return result;
  }

  getSidebarPanels(): TypedSidebarPanelContribution[] {
    const result: TypedSidebarPanelContribution[] = [];
    for (const { pluginName, ui } of this.plugins.values()) {
      if (ui.sidebarPanels) {
        for (const panel of ui.sidebarPanels) {
          result.push({
            ...panel,
            component: panel.component as TypedSidebarPanelContribution['component'],
            pluginName,
          });
        }
      }
    }
    return result.sort((a, b) => (a.order ?? 200) - (b.order ?? 200));
  }

  getSettingsSections(scope: 'global' | 'project'): TypedSettingsSectionContribution[] {
    const result: TypedSettingsSectionContribution[] = [];
    for (const { pluginName, ui } of this.plugins.values()) {
      if (ui.settingsSections) {
        for (const section of ui.settingsSections) {
          if (section.scope === scope || section.scope === 'both') {
            result.push({
              ...section,
              component: section.component as TypedSettingsSectionContribution['component'],
              pluginName,
            });
          }
        }
      }
    }
    return result.sort((a, b) => (a.order ?? 200) - (b.order ?? 200));
  }

  getScreens(): TypedScreenContribution[] {
    const result: TypedScreenContribution[] = [];
    for (const { pluginName, ui } of this.plugins.values()) {
      if (ui.screens) {
        for (const screen of ui.screens) {
          result.push({
            ...screen,
            component: screen.component as TypedScreenContribution['component'],
            pluginName,
          });
        }
      }
    }
    return result.sort((a, b) => (a.order ?? 200) - (b.order ?? 200));
  }

  getToolRenderer(toolName: string): TypedToolRendererContribution | undefined {
    for (const { pluginName, ui } of this.plugins.values()) {
      if (ui.toolRenderers) {
        for (const renderer of ui.toolRenderers) {
          if (renderer.toolNames.includes(toolName)) {
            return {
              ...renderer,
              component: renderer.component as TypedToolRendererContribution['component'],
              pluginName,
            };
          }
        }
      }
    }
    return undefined;
  }

  getChatDecorators(position: 'before' | 'after' | 'wrap'): TypedChatDecoratorContribution[] {
    const result: TypedChatDecoratorContribution[] = [];
    for (const { pluginName, ui } of this.plugins.values()) {
      if (ui.chatDecorators) {
        for (const decorator of ui.chatDecorators) {
          if (decorator.position === position) {
            result.push({
              ...decorator,
              component: decorator.component as TypedChatDecoratorContribution['component'],
              pluginName,
            });
          }
        }
      }
    }
    return result;
  }

  getAuthProviders(): TypedAuthProviderContribution[] {
    const result: TypedAuthProviderContribution[] = [];
    for (const { pluginName, ui } of this.plugins.values()) {
      if (ui.authProviders) {
        for (const provider of ui.authProviders) {
          result.push({
            ...provider,
            connectionComponent: provider.connectionComponent as TypedAuthProviderContribution['connectionComponent'],
            settingsComponent: provider.settingsComponent as TypedAuthProviderContribution['settingsComponent'],
            getAuthHeaders: provider.getAuthHeaders as AuthProviderHeadersFn | undefined,
            pluginName,
          });
        }
      }
    }
    return result;
  }

  getAuthProvider(id: string): TypedAuthProviderContribution | undefined {
    return this.getAuthProviders().find((p) => p.id === id);
  }

  // ========== Convenience: register individual typed contributions ==========

  /**
   * Register a single typed auth provider contribution directly.
   * This is a convenience for built-in plugins that don't go through the
   * agent-core UIPluginContributions interface.
   */
  registerAuthProvider(provider: TypedAuthProviderContribution): void {
    const existing = this.plugins.get(provider.pluginName);
    const ui = existing?.ui ?? {};
    const authProviders = [...(ui.authProviders ?? []), provider];
    this.plugins.set(provider.pluginName, {
      pluginName: provider.pluginName,
      ui: { ...ui, authProviders },
    });
    log.info(`Registered auth provider: ${provider.id} from plugin: ${provider.pluginName}`);
    this.notify();
  }

  // ========== Subscription (for useSyncExternalStore) ==========

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version++;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
