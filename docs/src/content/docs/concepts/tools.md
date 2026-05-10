---
title: Tools
description: The tools system — built-in tools, platform-agnostic tools, and how agents use them.
sidebar:
  order: 3
---

Tools are capabilities that agents can use to interact with the world — reading files, running commands, browsing the web, and more.

## Built-in Tools

OpenMgr includes several tool packages:

### Platform-Agnostic Tools (`packages/tools/`)

Tools that work on any platform:

- **File operations** — Read, write, create, and delete files
- **Search** — Search file contents with regex patterns
- **Directory listing** — Browse project file trees

### Terminal Tools (`packages/tools-terminal/`)

Node.js-specific tools for terminal and filesystem operations:

- **Terminal execution** — Run shell commands in the project workspace
- **Process management** — Start, stop, and monitor processes

### Browser Tools (full image only)

Available in the full Docker image (not the lite variant):

- **Page navigation** — Open URLs and navigate web pages
- **Content extraction** — Read page content and take screenshots
- **Interaction** — Click, type, and interact with web elements

## How Agents Use Tools

When an agent receives a prompt, it sends the message to the LLM along with descriptions of all available tools. The LLM can then:

1. **Request a tool call** — The LLM returns a structured tool call request with the tool name and parameters
2. **Agent executes** — The agent runs the tool and captures the result
3. **Result fed back** — The tool result is sent back to the LLM for the next step
4. **Iteration** — The LLM may request more tool calls or produce a final text response

This loop allows agents to perform complex multi-step tasks.

## Tool Registration

Tools are registered via the Tool registry in the agent framework:

```typescript
// Simplified example
agent.tools.register({
  name: "read_file",
  description: "Read the contents of a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to read" },
    },
    required: ["path"],
  },
  execute: async ({ path }) => {
    const content = await fs.readFile(path, "utf-8");
    return { content };
  },
});
```

## Tool Permissions

Tools can be restricted on a per-project basis to control what agents can do. The approval system can also require human approval before certain tools are executed.
