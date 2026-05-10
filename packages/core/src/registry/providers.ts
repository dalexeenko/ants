import type { LLMProvider } from "../types.js";
import type { ProviderDefinition, ProviderOptions } from "../plugin.js";

/**
 * Registry for LLM provider definitions.
 * Providers are registered by name and can be instantiated with options.
 */
export class ProviderRegistry {
  private providers: Map<string, ProviderDefinition> = new Map();

  /**
   * Register a provider
   */
  register(provider: ProviderDefinition): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Unregister a provider by name
   */
  unregister(name: string): boolean {
    return this.providers.delete(name);
  }

  /**
   * Get a provider definition by name
   */
  get(name: string): ProviderDefinition | undefined {
    return this.providers.get(name);
  }

  /**
   * Check if a provider is registered
   */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Get all registered provider names
   */
  getNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Create a provider instance
   */
  create(name: string, options: ProviderOptions = {}): LLMProvider {
    const definition = this.providers.get(name);
    if (!definition) {
      const available = this.getNames().join(", ");
      throw new Error(
        `Provider not found: ${name}. Available providers: ${available || "none"}`
      );
    }
    return definition.factory(options);
  }

  /**
   * Clear all registered providers
   */
  clear(): void {
    this.providers.clear();
  }
}

/**
 * Global provider registry instance
 */
export const providerRegistry = new ProviderRegistry();
