---
title: Desktop App
description: The OpenMgr Electron desktop app for managing agents on macOS, Windows, and Linux.
sidebar:
  order: 2
---

The OpenMgr desktop app is an Electron application that provides a native experience for managing your AI coding agents.

## Features

- **Native UI** — Platform-native look and feel using the shared `@openmgr/ui` component library
- **Server connection** — Connect to any OpenMgr server (local or remote)
- **Project management** — Full project, session, and file management
- **Terminal integration** — Built-in terminal for project workspaces

## Running from Source

```bash
# From the monorepo root
cd apps/desktop
pnpm dev
```

This starts the Electron app in development mode with hot reload.

## Building

```bash
cd apps/desktop
pnpm build
```

The build produces platform-specific packages for macOS, Windows, and Linux.

## Architecture

The desktop app is a thin wrapper around the shared `AppShell` component from `@openmgr/ui`. The renderer process uses react-native-web for cross-platform component compatibility.

- **Main process** — Handles Electron lifecycle, IPC, and platform-specific features
- **Renderer process** — React UI using the shared component library
- **Preload** — Bridge between main and renderer processes

## Connecting to a Server

The desktop app connects to an OpenMgr server instance. You can connect to:

- A local server running on `localhost:6647`
- A remote server at any accessible URL

Enter the server URL and bearer token (or login credentials in multi-user mode) to connect.
