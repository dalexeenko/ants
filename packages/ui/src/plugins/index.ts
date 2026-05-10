/**
 * @ants/ui/plugins — Public exports for the UI plugin system.
 *
 * This module is the public API for plugin authors and app integrations.
 * It re-exports the registry, context/hooks, and typed interfaces.
 */

// Registry
export { UIPluginRegistry } from './UIPluginRegistry';

// Context + Hooks
export {
  UIPluginProvider,
  type UIPluginProviderProps,
  useUIPluginRegistry,
  usePluginMiddleTabs,
  usePluginSidebarPanels,
  usePluginSettingsSections,
  usePluginScreens,
  usePluginToolRenderer,
  usePluginChatDecorators,
  usePluginAuthProviders,
  usePluginAuthProvider,
} from './UIPluginContext';

// Built-in plugins
export { cloudflareAccessAuthProvider } from './cloudflare-access';

// Typed interfaces and props
export type {
  PluginUIContext,
  MiddleTabProps,
  SidebarPanelProps,
  SettingsSectionProps,
  ScreenProps,
  ToolRendererProps,
  ChatDecoratorProps,
  AuthProviderConnectionProps,
  AuthProviderSettingsProps,
  AuthProviderHeadersFn,
  TypedMiddleTabContribution,
  TypedSidebarPanelContribution,
  TypedSettingsSectionContribution,
  TypedScreenContribution,
  TypedToolRendererContribution,
  TypedChatDecoratorContribution,
  TypedAuthProviderContribution,
} from './types';
