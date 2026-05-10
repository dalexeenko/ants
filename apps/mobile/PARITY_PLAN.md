# Mobile Parity Plan

## Overview

This document outlines the work to bring the mobile app to feature parity with the desktop app. It covers both an explicit tab/sidebar rework and broader parity gaps discovered during analysis.

## Current State

### Desktop Architecture
- **Icon Rail** (48px left edge): Projects, Director, Agents, Settings
- **Left Sidebar**: Project list with sessions (resizable, collapsible)
- **Middle Panel**: Multi-tab system (chat, file-editor, subagent, terminal, browser) with `MiddleTabBar`
- **Right Sidebar**: Session-specific panels (Files, Todos, Tasks, Activity, Terminal) with tab switching

### Mobile Architecture (Current)
- **Drawer**: Home, Director, Agents, Tools, Settings
- **Session Screen**: Bottom tab bar with Chat, Files, Terminal (remote only)
- **Tools Screen**: Separate screen via drawer with segmented Todos/Tasks/Activity — requires leaving the session

### Key Problems
1. Todos/Tasks/Activity require leaving the session (drawer → Tools screen)
2. No concept of "open tabs" (terminals, files, subagents)
3. No way to view subagent chat sessions
4. Files open in a read-only viewer on a separate screen instead of an editable tab
5. "Tools" in the drawer is session-specific content that doesn't belong in global navigation

---

## Phase 1: Session Tab Bar Rework + More Tab

### 1.1 Rework `SessionScreen.tsx` tab bar

**File:** `apps/mobile/src/screens/SessionScreen.tsx`

**Current tabs:** Chat, Files, Terminal (remote only)
**New tabs:** Chat, Files, Todos, Tasks, More

Changes:
- Change `TabId` type to `'chat' | 'files' | 'todos' | 'tasks' | 'more'`
- New tab definitions with icons:
  - Chat → `chat` icon
  - Files → `folder` icon
  - Todos → `check-square` icon
  - Tasks → `users` icon
  - More → `more-horizontal` icon
- Remove Terminal tab (moves to More's static section)
- Remove conditional tab logic for remote vs local projects
- Render `TodosPanel` for the Todos tab (pass `sessionId`)
- Render `SubagentsPanel` for the Tasks tab (pass `sessionId`, `onSubagentSelect`)
- Render `MorePanel` for the More tab
- Lift More tab navigation state up to `SessionScreen` level:
  - `openTabs: MoreTabEntry[]` — list of open sub-screens
  - `activeMoreTabId: string | null` — which sub-screen is currently shown
  - `openInMoreTab(entry)` — adds entry, sets active, switches to More tab
  - `closeMoreTab(id)` — removes entry, resets active if it was the closed one
- Wire cross-tab navigation:
  - `SubagentsPanel.onSubagentSelect` → `openInMoreTab({ type: 'subagent', ... })`
  - `FileBrowser.onFileOpen` → `openInMoreTab({ type: 'file-editor', ... })`
- Model/mode picker bar stays visible only on Chat tab (unchanged)

### 1.2 Create `MorePanel` component

**New file:** `apps/mobile/src/screens/MorePanel.tsx`

#### Data Types

```typescript
type MoreTabEntry = {
  id: string;          // e.g., 'activity', 'terminal:123', 'subagent:sid', 'file:/path/to/file.ts'
  type: 'activity' | 'terminal' | 'subagent' | 'file-editor';
  label: string;       // Display name
  data: Record<string, any>;  // Type-specific data
};
```

#### Default View (no sub-screen active)

Two sections:

**Static Section** (top, always present):
- "Activity" row → tapping adds activity entry to open tabs and pushes it
- "New Terminal" row → creates a new terminal entry and pushes it (only shown for remote projects)

**Dynamic Section** (bottom):
- "Open Tabs" header
- List of `openTabs` entries, each showing:
  - Icon based on type (activity, terminal, file, subagent)
  - Label text
  - Close (X) button
- Tapping an entry navigates to its sub-screen
- Empty state: "No open tabs" message

#### Sub-Screen View (when activeMoreTabId is set)

- Header: back arrow + sub-screen title
- Content area renders based on entry type:
  - `activity` → `ActivityPanel` from `@ants/ui` (pass `sessionId`)
  - `terminal` → `RemoteTerminal` from `@ants/ui` (pass `bridge`, `projectId`)
  - `subagent` → `SubagentChatView` from `@ants/ui` (pass `bridge`, `projectId`, `subagentSessionId`)
  - `file-editor` → `FileEditorTab` from `@ants/ui` (pass `bridge`, `projectId`, `filePath`)

#### State Persistence

Open tabs persist across tab switches within the session. When user goes Chat → Files → More, their open terminals/files are still there. State resets when leaving the session entirely.

### 1.3 Remove "Tools" from drawer

**Files:**
- `apps/mobile/src/components/Drawer.tsx` — Remove `tools` item from `DrawerNavigation` items array, remove `onNavigateToTools` prop
- `apps/mobile/src/App.tsx`:
  - Remove `tools` from `Screen` type union
  - Remove `navigateToTools` function
  - Remove `ToolsScreen` from `renderScreen()` switch
  - Remove `onNavigateToTools` from `DrawerNavigation` props
  - Remove `file-viewer` from `Screen` type (files now open in More tab)
  - Remove `navigateToFileViewer` function
  - Remove `FileViewerScreen` from `renderScreen()` switch
  - Remove `onNavigateToFileViewer` from `SessionScreen` props
- `apps/mobile/src/screens/ToolsScreen.tsx` — Delete file
- `apps/mobile/src/screens/index.ts` — Remove `ToolsScreen` export, add `MorePanel` export

### 1.4 Wire file opens through More tab

Instead of `SessionScreen` calling `onNavigateToFileViewer` (which navigates to a separate top-level screen), file opens from `FileBrowser` now go through `openInMoreTab`:

```typescript
// In SessionScreen
const handleFileOpen = (file: FileEntry) => {
  openInMoreTab({
    id: `file:${file.path}`,
    type: 'file-editor',
    label: file.name,
    data: { filePath: file.path },
  });
};
```

---

## Phase 2: Chat Enhancements

### 2.1 TokenUsageBar in session

**File:** `apps/mobile/src/screens/SessionScreen.tsx`

Add `TokenUsageBar` (from `@ants/ui`) to the model picker bar area, alongside `ModePickerModal` and `ModelPicker`. The shared component is already cross-platform. Show it in a compact form that fits the mobile layout.

### 2.2 File path click handling in chat

**Files:**
- `apps/mobile/src/screens/ChatScreen.tsx` — Add `onFilePathPress?: (filePath: string) => void` callback prop
- Check if `AssistantMessage` / `ToolCallBlock` in `packages/ui/src/chat/` already support an `onFilePathPress` callback. If not, add support to the shared components.
- In `SessionScreen`, wire `ChatScreen.onFilePathPress` → `openInMoreTab({ type: 'file-editor', ... })`

---

## Phase 3: Director Session List

### 3.1 Add session list to `DirectorScreen`

**File:** `apps/mobile/src/screens/DirectorScreen.tsx`

Current state: The Director screen has a header with a "+" button and renders `DirectorChatView`. There is no session list — users can only interact with the "current" session and can't browse or switch to previous ones.

Changes:
- On mount, call `bridge.directorListSessions()` to populate `useDirectorStore.sessions`
- Add a collapsible session list panel (or a bottom sheet) showing all Director sessions
- Each session row shows: title (or "Untitled"), relative timestamp, processing indicator
- Tap session → switch to it via `useDirectorStore.setCurrentSession(id)`
- Swipe-to-delete or long-press-to-delete → `bridge.directorDeleteSession(id)`
- The existing "+" button creates a new session (already works)

---

## Phase 4: Project Settings Parity

### 4.1 Session Defaults card

**File:** `apps/mobile/src/screens/ProjectSettingsScreen.tsx`

Add a "Session Defaults" section between `PermissionSettings` and Danger Zone:
- Default Mode picker (Plan/Build) — reuse the same component/pattern desktop uses
- Max Auto-Complete Loops — numeric input

Check the desktop `ProjectSettingsPanel` for the exact component structure and bridge API calls used.

### 4.2 Scheduled Tasks (remote projects only)

**File:** `apps/mobile/src/screens/ProjectSettingsScreen.tsx`

- Import `TasksDashboard` from `@ants/ui`
- Add an "Advanced Features" section visible only for remote projects (`project.providerType === 'remote'`)
- Add a navigable row "Scheduled Tasks" that renders `TasksDashboard` in a sub-view (using the same internal `SettingsView` pattern already used for tools/subagents drill-down)
- The component uses direct HTTP calls to server API endpoints, which work the same on mobile

### 4.3 Approvals (remote projects only)

**File:** `apps/mobile/src/screens/ProjectSettingsScreen.tsx`

- Import `ApprovalsDashboard` from `@ants/ui`
- Add "Approvals" as another row in the "Advanced Features" section
- Renders `ApprovalsDashboard` in a sub-view
- Features: define approval rules (tool pattern matching), review pending approval requests (approve/deny), view approval history

### 4.4 WorktreeDiffPanel

**File:** `apps/mobile/src/screens/MorePanel.tsx`

- When the current session is a worktree session, add a "Worktree Diff" entry in the static section of the More tab
- Tapping it pushes `WorktreeDiffPanel` (from `@ants/ui`) into the More navigation stack
- Detect worktree sessions by checking session metadata (check how desktop determines this)

---

## Phase 5: Global Search Accessibility

### 5.1 Add search to session screen

**File:** `apps/mobile/src/screens/SessionScreen.tsx`

Currently `GlobalSearch` is only on `HomeScreen`. Add a search icon button in the session header that opens `GlobalSearch` as a modal overlay. On result selection, navigate to the selected session (via the existing navigation callbacks).

---

## Execution Order

1. **Phase 1** — Tab rework + More tab (largest change, core request)
2. **Phase 2** — Chat enhancements (builds on Phase 1's More tab)
3. **Phase 4** — Project settings parity (independent, straightforward)
4. **Phase 3** — Director session list (independent, moderate complexity)
5. **Phase 5** — Global search (small addition)

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `apps/mobile/src/screens/SessionScreen.tsx` | Major rework — 5-tab bar, lifted More state, TokenUsageBar, search | 1, 2, 5 |
| `apps/mobile/src/screens/MorePanel.tsx` | **New** — More tab with nav stack, static actions, open tabs | 1 |
| `apps/mobile/src/components/Drawer.tsx` | Remove "Tools" item, remove `onNavigateToTools` prop | 1 |
| `apps/mobile/src/App.tsx` | Remove tools/file-viewer screens, clean up navigation | 1 |
| `apps/mobile/src/screens/ToolsScreen.tsx` | **Delete** | 1 |
| `apps/mobile/src/screens/index.ts` | Update exports | 1 |
| `apps/mobile/src/screens/ChatScreen.tsx` | Add `onFilePathPress` callback | 2 |
| `packages/ui/src/chat/AssistantMessage.tsx` | Add file path press support (if not present) | 2 |
| `apps/mobile/src/screens/DirectorScreen.tsx` | Add session list | 3 |
| `apps/mobile/src/screens/ProjectSettingsScreen.tsx` | Add Session Defaults, Scheduled Tasks, Approvals | 4 |

## Parity Items NOT Included (and why)

| Item | Reason |
|------|--------|
| Browser tabs (embed + screencast) | Deferred — complex, Electron-specific for local |
| Plugin system on mobile | Mobile can't do dynamic imports (kills Metro) |
| Terminal for local projects | iOS sandboxing prevents shell spawning |
| Docker settings | Desktop/server-only concept |
| Stdio MCP servers | iOS can't spawn child processes |
| Keyboard shortcuts | Not applicable to mobile |
| Resizable panels | Touch UX uses different patterns |
