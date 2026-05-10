# Agent Instructions for packages/ui

## Overview

Shared React component library consumed by `apps/desktop/` (via react-native-web) and `apps/mobile/` (via React Native). Exports components, hooks, and the canonical **color palette** for the entire project.

## Color Palette (Source of Truth)

**All colors across every UI surface must come from `src/styles/tokens.ts`.** This file is the single source of truth. The server-ui (`packages/server-ui/src/styles.css`) mirrors these values as CSS custom properties — when updating the palette, update both files.

### Architecture

```
src/styles/tokens.ts   ← canonical palette definition
src/styles/theme.ts    ← resolveTheme(), useTheme(), ThemeContext
src/styles/index.ts    ← re-exports everything
```

Components access colors via `useTheme()`:

```tsx
const { colors, palette } = useTheme();
// colors.bg.primary, colors.text.inverse, colors.error, etc.
// palette.errorLight, palette.violet, palette.green, etc.
```

### Token Structure

**`colors`** — theme-aware tokens that change between light and dark mode:

| Token | Light | Dark | Usage |
|---|---|---|---|
| `bg.primary` | `#FFFFFF` | `#272E27` | Page/app background |
| `bg.secondary` | `#F5F7F5` | `#343C34` | Cards, sidebars |
| `bg.tertiary` | `#E8ECE8` | `#475047` | Nested/elevated surfaces |
| `bg.elevated` | `#FFFFFF` | `#343C34` | Floating elements |
| `text.primary` | `#111816` | `#F5F7F5` | Headings, body text |
| `text.secondary` | `#3D4A47` | `#95A095` | Descriptions, labels |
| `text.muted` | `#6B7A76` | `#748074` | Hints, placeholders |
| `text.inverse` | `#FFFFFF` | `#272E27` | Text on colored backgrounds |
| `border.light` | `#D4DAD4` | `#475047` | Subtle dividers |
| `border.medium` | `#B5BDB5` | `#5C665C` | Input borders |
| `border.heavy` | `#6B7A76` | `#748074` | Strong borders |

**Semantic colors** (same in both themes, accessed as `colors.primary`, `colors.error`, etc.):

| Token | Value | Usage |
|---|---|---|
| `primary` | `#5C6CA8` | Brand blue (desaturated), buttons, links |
| `primaryHover` | `#4E5E98` | Hover state |
| `primaryActive` | `#3F4E82` | Active/pressed state |
| `success` | `#4E9E76` | Success states |
| `warning` | `#B8923E` | Warning states |
| `error` | `#B85C5C` | Error states |
| `info` | `#5C6CA8` | Informational (same as primary) |

**`palette`** — extended colors for one-off/accent needs (toasts, category badges, status variants). Always accessed as `palette.xxx`:

| Token | Value | Usage |
|---|---|---|
| `primaryMuted` | `#2E3858` | Toast/banner info background |
| `errorHover` | `#9C4444` | Error icon on light bg, danger pressed |
| `errorMuted` | `#4E2222` | Toast error background |
| `errorLight` | `#EADADA` | Error banner light background |
| `successHover` | `#3E8862` | Success hover state |
| `successMuted` | `#1E4030` | Toast success background |
| `successLight` | `#D6EBE0` | Success banner light background |
| `warningHover` | `#9C7A2E` | Warning hover state |
| `warningMuted` | `#4E3E1A` | Toast warning background |
| `warningLight` | `#EDE5CE` | Warning banner light background |
| `warningDark` | `#7A5E28` | Warning icon on light bg |
| `violet` | `#8A78B4` | Category: bash, github |
| `indigo` | `#727AAE` | Category: todowrite, phasewrite |
| `pink` | `#B06888` | Category: library |
| `teal` | `#4E9E94` | Category: data |
| `orange` | `#B87E58` | Category: gitlab |
| `yellow` | `#9E9248` | Modified file status |
| `green` | `#5EAA68` | Connected/additions indicator |
| `greenDark` | `#428A4E` | Merge button |
| `black` | `#000000` | Shadow colors |
| `white` | `#FFFFFF` | Utility |
| `link` | `#8AB4C8` | Links on dark backgrounds |

### Design Philosophy

Colors are intentionally **desaturated** — every hue has gray mixed in so the palette feels cohesive and understated against the gray-green surfaces, while retaining enough chroma to be clearly readable. The primary blue is anchored around `rgb(92, 108, 168)` and all other semantic/accent colors follow the same treatment.

### Dark Theme Design

The dark theme uses a **gray-green** tinge (not pure gray, not Tailwind slate/blue). The scale is anchored at `#272E27` (rgb(39, 46, 39)) for `bg.primary`. Every step in the scale maintains the green undertone.

### Rules for Adding Colors

1. **Never hardcode hex colors in components.** Use `colors.xxx` or `palette.xxx`.
2. If you need a new color, add it to `palette` in `tokens.ts` and document it here.
3. New colors should follow the muted aesthetic — mix gray into the hue rather than using pure Tailwind values.
4. For alpha variants, append the hex alpha to a token: `colors.error + '15'` (not hardcoded).
5. For shadow colors, use `palette.black`.
6. For text on colored backgrounds (buttons, badges, toasts), use `colors.text.inverse`.
7. After updating `tokens.ts`, also update `packages/server-ui/src/styles.css` to match.

## Building

```bash
# UI source is consumed directly by bundlers (Vite/Metro) — no build step needed for dev.
# For production:
pnpm turbo build --filter=@ants/ui
```

## Testing

```bash
cd packages/ui && pnpm test
```

Uses `vitest` with `jsdom` environment and `react-native-web`.

## Key Directories

```
src/
  styles/          Design tokens, theme context, style utilities
  chat/            Chat view components (messages, input, tool blocks)
  panels/          Side panels (activity, todos, subagents, files, diff)
  primitives/      Base components (Button, Text, Input, Switch, Card)
  settings/        Settings screens (agents, tools, webhooks, tasks)
  shell/           App shell, layout, toast, sidebar
  sidebar/         Project sidebar, director sidebar
  terminal/        Remote terminal component
  search/          Global search overlay
  files/           File browser
  browser/         Embedded browser view
  platform/        PlatformAdapter interface and context
```
