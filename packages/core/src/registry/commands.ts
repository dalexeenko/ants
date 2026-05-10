import type { CommandDefinition, CommandContext, CommandResult } from "../plugin.js";

/**
 * Registry for slash commands.
 * Commands are registered by name and can be executed with args.
 */
export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();

  /**
   * Register a command
   */
  register(command: CommandDefinition): void {
    this.commands.set(command.name, command);
  }

  /**
   * Unregister a command by name
   */
  unregister(name: string): boolean {
    return this.commands.delete(name);
  }

  /**
   * Get a command by name
   */
  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  /**
   * Check if a command is registered
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Get all registered commands
   */
  getAll(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get all registered command names
   */
  getNames(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * Parse and execute a command string.
   * Returns null if the input is not a valid command.
   */
  async execute(input: string, ctx: CommandContext): Promise<CommandResult | null> {
    // Parse command: /name [args]
    const match = input.match(/^\/(\w+)(?:\s+(.*))?$/);
    if (!match) {
      return null;
    }

    const [, name, args] = match as [string, string, string | undefined];
    const command = this.commands.get(name);

    if (!command) {
      return null;
    }

    return command.execute(args ?? "", ctx);
  }

  /**
   * Clear all registered commands
   */
  clear(): void {
    this.commands.clear();
  }
}

/**
 * Global command registry instance
 */
export const commandRegistry = new CommandRegistry();
