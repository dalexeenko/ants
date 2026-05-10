/**
 * Typed UI Plugin contribution interfaces and component props.
 *
 * These narrow the `unknown` component types from @ants/agent-core
 * to proper `React.ComponentType<...>` for use in the UI layer.
 */

import type { ComponentType, ReactNode } from 'react';
import type { AgentBridge, ToolCall, Message, RemoteServerConfig } from '../agent/types';

// ============================================================================
// Shared Plugin Context
// ============================================================================

/** Shared context available to all plugin UI components */
export interface PluginUIContext {
  bridge: AgentBridge;
  projectId: string;
  sessionId?: string;
  pluginName: string;
}

// ============================================================================
// Component Props
// ============================================================================

export interface MiddleTabProps extends PluginUIContext {
  tabId: string;
  tabData?: Record<string, unknown>;
}

export interface SidebarPanelProps extends PluginUIContext {
  sessionId: string;
}

export interface SettingsSectionProps extends PluginUIContext {}

export interface ScreenProps extends PluginUIContext {}

export interface ToolRendererProps extends PluginUIContext {
  toolCall: ToolCall;
  isStreaming: boolean;
}

export interface ChatDecoratorProps extends PluginUIContext {
  message: Message;
  children?: ReactNode;
}

export interface AuthProviderConnectionProps {
  /** Current auth config values (for edit/display) */
  authConfig: Record<string, unknown>;
  /** Callback to update auth config values */
  onAuthConfigChange: (config: Record<string, unknown>) => void;
}

export interface AuthProviderSettingsProps {
  server: RemoteServerConfig;
  /** Current auth config values (for edit/display) */
  authConfig: Record<string, unknown>;
  /** Callback to update auth config values */
  onAuthConfigChange: (config: Record<string, unknown>) => void;
}

/** Function signature for producing auth headers from plugin-specific config */
export type AuthProviderHeadersFn = (authConfig: Record<string, unknown>) => Record<string, string>;

// ============================================================================
// Typed Contribution Interfaces (component narrowed to React.ComponentType)
// ============================================================================

export interface TypedMiddleTabContribution {
  type: string;
  label: string;
  icon: string;
  component: ComponentType<MiddleTabProps>;
  showInNewTabMenu?: boolean;
  pluginName: string;
}

export interface TypedSidebarPanelContribution {
  id: string;
  label: string;
  icon?: string;
  component: ComponentType<SidebarPanelProps>;
  order?: number;
  pluginName: string;
}

export interface TypedSettingsSectionContribution {
  id: string;
  label: string;
  description?: string;
  component: ComponentType<SettingsSectionProps>;
  scope: 'global' | 'project' | 'both';
  order?: number;
  pluginName: string;
}

export interface TypedScreenContribution {
  id: string;
  label: string;
  icon: string;
  component: ComponentType<ScreenProps>;
  order?: number;
  pluginName: string;
}

export interface TypedToolRendererContribution {
  toolNames: string[];
  component: ComponentType<ToolRendererProps>;
  pluginName: string;
}

export interface TypedChatDecoratorContribution {
  id: string;
  position: 'before' | 'after' | 'wrap';
  filter?: (message: unknown) => boolean;
  component: ComponentType<ChatDecoratorProps>;
  pluginName: string;
}

export interface TypedAuthProviderContribution {
  id: string;
  label: string;
  icon?: string;
  connectionComponent: ComponentType<AuthProviderConnectionProps>;
  settingsComponent: ComponentType<AuthProviderSettingsProps>;
  getAuthHeaders?: AuthProviderHeadersFn;
  pluginName: string;
}
