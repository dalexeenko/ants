# @ants/agent-worktree

Git worktree support for Ants agents — isolate branches with dedicated sessions.

## Status: Not Yet Integrated

This package is fully implemented (manager, plugin, tools, tests) but is **not yet wired into any consuming package** in the monorepo. No other package depends on `@ants/agent-worktree`.

It is kept here for future integration. To use it, you would need to:

1. Add `@ants/agent-worktree: workspace:*` as a dependency in the consuming package
2. Register the `worktreePlugin` with an agent instance
3. The plugin provides four tools: `worktree_create`, `worktree_list`, `worktree_switch`, `worktree_remove`

## Overview

- **WorktreeManager** — creates, lists, switches, and removes git worktrees
- **worktreePlugin** — agent plugin that registers worktree tools
- **Tools** — `worktree_create`, `worktree_list`, `worktree_switch`, `worktree_remove`

## Development

```bash
pnpm build      # Compile TypeScript
pnpm test       # Run tests
```
