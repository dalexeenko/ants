# Agent Instructions for apps/desktop

## Overview

Electron desktop app. The renderer process uses `@ants/ui` for all UI components. The main process manages windows, the local agent bridge, native dialogs, and IPC.

## Architecture

### Renderer

The renderer is a thin wrapper around the shared `AppShell` from `@ants/ui`:

- `src/renderer/App.tsx` — creates a `PlatformAdapter` that maps `window.electron` (exposed by the preload script) to the platform interface, then renders `<PlatformProvider><AppShell /></PlatformProvider>`
- `src/renderer/main.tsx` — React entry point, mounts `<App />`

The shared `AppShell` (`packages/ui/src/shell/AppShell.tsx`) contains the full app layout: icon rail, project sidebar, chat view, settings panels, toast notifications, etc. Platform-specific behavior (native file dialogs, keyboard shortcuts via Electron accelerators, embedded browser views, Director IPC) is injected through the `PlatformAdapter` interface (`packages/ui/src/platform/PlatformContext.tsx`).

### Main Process

- `src/main/index.ts` — window creation, IPC handlers, menu, auto-updater
- `src/main/services/desktopBridge.ts` — implements `AgentBridge` for local projects using the agent core packages; exposes it to the renderer via `contextBridge`
- `src/preload/index.ts` — preload script that creates the `window.agentBridge` and `window.electron` objects via `ipcRenderer.invoke()` calls

### Platform Adapter

The desktop `PlatformAdapter` (defined in `src/renderer/App.tsx`) maps Electron APIs to the shared interface:

| PlatformAdapter method | Electron API |
|---|---|
| `openDirectoryDialog` | `window.electron.openDirectoryDialog()` |
| `getDocumentsPath` | `window.electron.getDocumentsPath()` |
| `ensureDirectoryExists` | `window.electron.ensureDirectoryExists()` |
| `writeFile` | `window.electron.writeFile()` |
| `onShortcut` | `window.electron.onShortcut()` |
| `onDeeplink` | `window.electron.onDeeplink()` |
| `onDirectorNavigate` | `window.electron.onDirectorNavigate()` |
| `onDirectorSetTheme` | `window.electron.onDirectorSetTheme()` |
| `browserView` | `window.electron.browserView` |

## Colors

The desktop app has **no local color definitions**. All colors come from `@ants/ui` via the `ThemeContext`. See `packages/ui/AGENTS.md` for the canonical palette reference and usage guidelines. Never hardcode hex color values in renderer code.

## Building

```bash
# From monorepo root
pnpm turbo build --filter=desktop

# Dev mode with hot reload
cd apps/desktop && pnpm dev
```

The desktop build uses `electron-vite` which bundles the renderer with Vite. The `@ants/ui` source is consumed directly via path aliases (not built separately).

## Future Work

### Extract local-only UI into a `@ants/ui-local` plugin

Currently, local-only UI code (e.g. `AuthenticationSection` for on-device API key/OAuth management) still lives inline in `@ants/ui` and is conditionally hidden on web via `platform.platform !== 'web'` guards. A cleaner architecture would extract all local-only concerns into a dedicated UI plugin package:

1. **Create `packages/ui-local/`** — a `@ants/ui-local` package that registers local-only UI contributions via the existing `UIPluginRegistry` system.

2. **Move local-only settings sections** — `AuthenticationSection` (API key + OAuth management for the on-device agent) would be registered as a plugin settings section with `scope: 'global'` instead of being hardcoded in `SettingsPanel.tsx` and `WelcomeScreen.tsx`.

3. **Move Director screen/sidebar** — The Director agent is currently a local-only feature (runs as a local agent on desktop/mobile). The `DirectorSidebar` and `DirectorChatView` components, and the `useDirectorEvents` hook, would be contributed by the plugin as a screen + sidebar panel. The icon rail "sparkles" button would also come from the plugin.

4. **Move local MCP management** — The `McpServersSection` has stdio-based MCP server management that only works locally. The plugin would contribute this as a project settings section.

5. **Desktop registers the plugin at startup** — In `App.tsx`, after creating the `UIPluginRegistry`, call `registry.register('local', localPluginContributions)` before rendering `<AppShell />`.

6. **Web app skips it** — The web app (`packages/app-ui/`) simply doesn't import or register the local plugin, so none of the local-only UI appears. No conditional guards needed.

This would eliminate the `platform.platform !== 'web'` guards from the shared shell components and make the separation of concerns explicit through the plugin system rather than runtime conditionals.

### Server-side Director agent

The Director agent currently only runs locally on desktop/mobile. A future phase would add server-side Director support so the web app can use it too. This requires:

- A server-side Director agent process (similar to how project agents are managed)
- Server API endpoints for Director session management
- Bridge methods that route to the server instead of local IPC
