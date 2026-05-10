---
title: Mobile App
description: The Ants React Native mobile app for managing agents on iOS and Android.
sidebar:
  order: 3
---

The Ants mobile app is built with React Native and Expo, providing a native mobile experience for managing your AI coding agents.

## Features

- **Native mobile UI** — Platform-native components for iOS and Android
- **Server connection** — Connect to any Ants server
- **Project management** — View and manage projects and sessions
- **Push notifications** — Get notified about agent activity (requires VAPID configuration)

## Running from Source

```bash
# From the monorepo root
cd apps/mobile

# Start the Expo dev server
npx expo start

# Run on iOS simulator
npx expo run:ios

# Run on Android emulator
npx expo run:android
```

## Architecture

The mobile app shares UI components with the desktop app via the `@ants/ui` package. Components are built with React Native primitives and work across both platforms.

## Connecting to a Server

Enter your Ants server URL and authenticate with either a bearer token or user credentials (multi-user mode) to connect.

:::note
For the mobile app to connect to a remote server, the server must be accessible over HTTPS. See the [Production Hardening guide](/guides/production/) for setup instructions.
:::
