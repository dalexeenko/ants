# Agent Instructions for packages/server-ui

## Overview

Standalone React + Vite SPA for the server's web admin interface. Built to `dist/` and served by `apps/server/`. Does **not** depend on `@ants/ui` — it uses plain CSS with its own component set.

## Color Palette

Colors are defined as CSS custom properties in `src/styles.css`. These values are **mirrored from** `packages/ui/src/styles/tokens.ts`, which is the single source of truth for the project's color palette.

When updating colors:
1. Update `packages/ui/src/styles/tokens.ts` first (the canonical source).
2. Then update the CSS variables in `src/styles.css` to match.
3. See `packages/ui/AGENTS.md` for the full palette reference.

### CSS Variable → Token Mapping

| CSS Variable | Dark Value | Light Value | Token Source |
|---|---|---|---|
| `--bg-primary` | `#272E27` | `#FFFFFF` | `colors.dark.bg.primary` / `colors.light.bg.primary` |
| `--bg-secondary` | `#343C34` | `#F5F7F5` | `colors.dark.bg.secondary` / `colors.light.bg.secondary` |
| `--bg-elevated` | `#475047` | `#E8ECE8` | `colors.dark.bg.tertiary` / `colors.light.bg.tertiary` |
| `--text-primary` | `#F5F7F5` | `#111816` | `colors.dark.text.primary` / `colors.light.text.primary` |
| `--text-secondary` | `#95A095` | `#3D4A47` | `colors.dark.text.secondary` / `colors.light.text.secondary` |
| `--text-muted` | `#748074` | `#6B7A76` | `colors.dark.text.muted` / `colors.light.text.muted` |
| `--border-light` | `#475047` | `#D4DAD4` | `colors.dark.border.light` / `colors.light.border.light` |
| `--primary` | `#5C6CA8` | `#5C6CA8` | `palette.primary` |
| `--primary-hover` | `#4E5E98` | `#4E5E98` | `palette.primaryHover` |
| `--success` | `#4E9E76` | `#3E8862` | `palette.success` / `palette.successHover` |
| `--error` | `#B85C5C` | `#9C4444` | `palette.error` / `palette.errorHover` |
| `--warning` | `#B8923E` | `#9C7A2E` | `palette.warning` / `palette.warningHover` |

### Theme Switching

The server-ui uses `@media (prefers-color-scheme: light)` to switch themes — it follows the OS setting. There is no manual toggle.

### Rules

- Never hardcode hex colors in `.tsx` files. Use `var(--token-name)` in inline styles.
- For alpha/transparent variants, use `color-mix(in srgb, var(--token) NN%, transparent)`.
- CSS variable fallbacks are not needed — the variables are always defined.

## Building

```bash
pnpm turbo build --filter=@ants/server-ui
```

Output goes to `dist/`. The server copies this during its own build.

## Architecture

- `src/App.tsx` — Router setup, layout with sidebar
- `src/pages/` — Page components (Dashboard, Settings, Projects, Tasks, Webhooks, etc.)
- `src/components/` — Shared components (ErrorBoundary)
- `src/lib/` — Auth context, API helpers
- `src/styles.css` — All CSS (theme variables, layout, components, utilities)

## Styling Approach

All styling is hand-written vanilla CSS in `src/styles.css`. No Tailwind, no CSS-in-JS. Components use CSS class names (`.card`, `.btn`, `.badge-success`, etc.) and CSS custom properties for theming.
