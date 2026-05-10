---
title: MCP Integration
description: Model Context Protocol (MCP) support — connecting to MCP servers and using Ants as an MCP server.
sidebar:
  order: 5
---

Ants supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) for extending agent capabilities and integrating with external tools.

## What is MCP?

MCP is an open protocol that standardizes how AI applications connect to external data sources and tools. It provides a common interface for:

- **Tools** — Functions that agents can call (e.g., database queries, API calls)
- **Resources** — Data that can be read by agents (e.g., files, database records)
- **Prompts** — Reusable prompt templates

## Connecting MCP Servers

Agents can connect to external MCP servers to gain access to additional tools and resources. MCP servers are configured per-project through the plugin system.

This allows you to extend agent capabilities without modifying the agent code — just connect an MCP server that provides the tools you need.

## Ants as an MCP Server

The Ants server can also act as an MCP server itself via the `ants-server-mcp` binary. This allows external tools and editors (like VS Code, Cursor, etc.) to connect to Ants and use its capabilities.

## Plugin System

MCP servers are loaded through the agent's plugin system. The plugin system also supports:

- **Custom tools** — Register new tools for agents to use
- **Custom providers** — Add new LLM provider adapters
- **Custom commands** — Add slash commands to the agent
- **Capabilities** — Declare and query feature flags
