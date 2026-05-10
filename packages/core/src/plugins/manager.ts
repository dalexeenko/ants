/**
 * PluginManager - Runtime plugin installation and management.
 *
 * Handles:
 * - Installing npm packages into an isolated plugin directory
 * - Dynamically importing and validating plugin exports
 * - Registering/unregistering plugins with the Agent
 * - Tracking which plugins are installed and their source packages
 *
 * A valid plugin package can export:
 * - A default export that is an AgentPlugin object
 * - A default export that is a function returning an AgentPlugin
 * - A default export that is an array of AgentPlugin objects or factories
 * - Named exports: `plugin`, `plugins`, or `createPlugin` following the same patterns
 */

import type { AgentPlugin } from "../plugin.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Information about an installed plugin package.
 */
export interface InstalledPluginInfo {
  /** The npm package specifier used to install (e.g., "my-plugin" or "my-plugin@1.0.0") */
  packageSpec: string;
  /** The resolved package name (without version) */
  packageName: string;
  /** The installed version (from package.json) */
  version: string;
  /** Names of the AgentPlugin(s) extracted from this package */
  pluginNames: string[];
  /** When this package was installed */
  installedAt: number;
}

/**
 * Options for the PluginManager.
 */
export interface PluginManagerOptions {
  /**
   * Directory where plugins are installed.
   * A node_modules subdirectory will be created here.
   * Defaults to ~/.config/ants/plugins/
   */
  pluginDir: string;

  /**
   * Optional function to execute shell commands.
   * Must run the command in the given cwd and return { stdout, stderr, exitCode }.
   * If not provided, uses Node.js child_process.execSync.
   */
  exec?: (
    command: string,
    cwd: string
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/**
 * Result of a plugin installation.
 */
export interface PluginInstallResult {
  /** The npm package specifier used */
  packageSpec: string;
  /** Resolved package name */
  packageName: string;
  /** Installed version */
  version: string;
  /** AgentPlugin instances extracted from the package */
  plugins: AgentPlugin[];
}

/**
 * Validates that a value looks like an AgentPlugin.
 */
function isAgentPlugin(value: unknown): value is AgentPlugin {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.name === "string" && obj.name.length > 0;
}

/**
 * Extracts AgentPlugin(s) from a module's exports.
 * Supports default exports, named exports, arrays, and factory functions.
 */
function extractPlugins(moduleExports: Record<string, unknown>): AgentPlugin[] {
  const plugins: AgentPlugin[] = [];
  const seen = new Set<string>();

  function tryAdd(value: unknown): void {
    // Direct plugin object
    if (isAgentPlugin(value)) {
      if (!seen.has(value.name)) {
        seen.add(value.name);
        plugins.push(value);
      }
      return;
    }

    // Factory function (no-arg, returns plugin)
    if (typeof value === "function") {
      try {
        const result = (value as () => unknown)();
        if (isAgentPlugin(result)) {
          if (!seen.has(result.name)) {
            seen.add(result.name);
            plugins.push(result);
          }
        } else if (Array.isArray(result)) {
          for (const item of result) {
            tryAdd(item);
          }
        }
      } catch {
        // Not a valid factory, skip
      }
      return;
    }

    // Array of plugins or factories
    if (Array.isArray(value)) {
      for (const item of value) {
        tryAdd(item);
      }
    }
  }

  // Priority order: default > plugin > plugins > createPlugin > all other named exports
  const priorityKeys = ["default", "plugin", "plugins", "createPlugin"];
  for (const key of priorityKeys) {
    if (key in moduleExports) {
      tryAdd(moduleExports[key]);
    }
  }

  // If none found yet, try all other exports
  if (plugins.length === 0) {
    for (const [key, value] of Object.entries(moduleExports)) {
      if (!priorityKeys.includes(key)) {
        tryAdd(value);
      }
    }
  }

  return plugins;
}

// ============================================================================
// PluginManager
// ============================================================================

export class PluginManager {
  private pluginDir: string;
  private exec: PluginManagerOptions["exec"];
  private installed: Map<string, InstalledPluginInfo> = new Map();
  /** Maps plugin name -> package name for reverse lookup during uninstall */
  private pluginToPackage: Map<string, string> = new Map();
  private initialized = false;

  constructor(options: PluginManagerOptions) {
    this.pluginDir = options.pluginDir;
    this.exec = options.exec;
  }

  /**
   * Ensure the plugin directory exists and has a package.json.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const exec = this.getExec();

    // Create plugin dir if it doesn't exist
    await exec(`mkdir -p "${this.pluginDir}"`, this.pluginDir);

    // Create a package.json if one doesn't exist, so npm has somewhere to install to
    try {
      await exec(`test -f package.json`, this.pluginDir);
    } catch {
      await exec(
        `echo '${JSON.stringify({ name: "ants-plugins", version: "1.0.0", private: true, type: "module" })}' > package.json`,
        this.pluginDir
      );
    }

    this.initialized = true;
  }

  /**
   * Install an npm package and extract its plugins.
   *
   * @param packageSpec - npm package specifier (e.g., "my-plugin", "my-plugin@1.2.3", "@scope/plugin")
   * @returns The extracted plugins, ready to be registered with agent.use()
   */
  async install(packageSpec: string): Promise<PluginInstallResult> {
    await this.init();

    const exec = this.getExec();

    // Run npm install
    const installResult = await exec(
      `npm install --save "${packageSpec}" 2>&1`,
      this.pluginDir
    );

    if (installResult.exitCode !== 0) {
      throw new Error(
        `Failed to install "${packageSpec}": ${installResult.stderr || installResult.stdout}`
      );
    }

    // Determine the actual package name (strip version/tag from spec)
    const packageName = this.parsePackageName(packageSpec);

    // Read the installed package's version from its package.json
    let version = "unknown";
    try {
      const pkgJsonResult = await exec(
        `cat node_modules/${packageName}/package.json`,
        this.pluginDir
      );
      if (pkgJsonResult.exitCode === 0) {
        const pkgJson = JSON.parse(pkgJsonResult.stdout);
        version = pkgJson.version ?? "unknown";
      }
    } catch {
      // version stays "unknown"
    }

    // Dynamically import the package
    const modulePath = `${this.pluginDir}/node_modules/${packageName}`;
    const moduleExports = await this.dynamicImport(modulePath);

    // Extract and validate plugins
    const plugins = extractPlugins(moduleExports);

    if (plugins.length === 0) {
      // Clean up - uninstall the package since it had no valid plugins
      await exec(`npm uninstall "${packageName}" 2>&1`, this.pluginDir).catch(() => {});
      throw new Error(
        `Package "${packageSpec}" does not export any valid AgentPlugin. ` +
        `A plugin must export an object with at least a "name" property (string). ` +
        `Supported export patterns: default export, named "plugin"/"plugins"/"createPlugin", ` +
        `factory functions, or arrays of any of the above.`
      );
    }

    // Track installation
    const info: InstalledPluginInfo = {
      packageSpec,
      packageName,
      version,
      pluginNames: plugins.map((p) => p.name),
      installedAt: Date.now(),
    };

    this.installed.set(packageName, info);
    for (const plugin of plugins) {
      this.pluginToPackage.set(plugin.name, packageName);
    }

    return { packageSpec, packageName, version, plugins };
  }

  /**
   * Uninstall a plugin package by npm package name.
   *
   * @param packageName - The npm package name to uninstall
   * @returns The names of the plugins that were part of this package
   */
  async uninstall(packageName: string): Promise<string[]> {
    await this.init();

    const info = this.installed.get(packageName);
    if (!info) {
      throw new Error(`Package "${packageName}" is not installed`);
    }

    const exec = this.getExec();

    const result = await exec(
      `npm uninstall "${packageName}" 2>&1`,
      this.pluginDir
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to uninstall "${packageName}": ${result.stderr || result.stdout}`
      );
    }

    // Clean up tracking
    const pluginNames = info.pluginNames;
    for (const name of pluginNames) {
      this.pluginToPackage.delete(name);
    }
    this.installed.delete(packageName);

    return pluginNames;
  }

  /**
   * Get the package name that a plugin came from.
   */
  getPackageForPlugin(pluginName: string): string | undefined {
    return this.pluginToPackage.get(pluginName);
  }

  /**
   * Get info about all installed plugin packages.
   */
  listInstalled(): InstalledPluginInfo[] {
    return Array.from(this.installed.values());
  }

  /**
   * Check if a package is installed.
   */
  isInstalled(packageName: string): boolean {
    return this.installed.has(packageName);
  }

  /**
   * Get the plugin directory path.
   */
  getPluginDir(): string {
    return this.pluginDir;
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private getExec(): NonNullable<PluginManagerOptions["exec"]> {
    if (this.exec) return this.exec;

    // Default Node.js implementation
    return async (command: string, cwd: string) => {
      const { execSync } = await import("node:child_process");
      try {
        const stdout = execSync(command, {
          cwd,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 120_000, // 2 minute timeout for npm operations
        });
        return { stdout, stderr: "", exitCode: 0 };
      } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; status?: number };
        return {
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          exitCode: error.status ?? 1,
        };
      }
    };
  }

  /**
   * Dynamically import a module path.
   * Returns the module's exports as a record.
   */
  private async dynamicImport(
    modulePath: string
  ): Promise<Record<string, unknown>> {
    try {
      // Use dynamic import - works with both ESM and CJS packages
      // The pathToFileURL approach ensures proper resolution on all platforms
      const { pathToFileURL } = await import("node:url");
      const moduleUrl = pathToFileURL(modulePath).href;
      const mod = await import(moduleUrl);
      return mod as Record<string, unknown>;
    } catch (err) {
      // Fallback: try direct path import
      try {
        const mod = await import(modulePath);
        return mod as Record<string, unknown>;
      } catch {
        throw new Error(
          `Failed to import plugin from "${modulePath}": ${(err as Error).message}`
        );
      }
    }
  }

  /**
   * Parse the package name from a package specifier.
   * Examples:
   *   "my-plugin" -> "my-plugin"
   *   "my-plugin@1.0.0" -> "my-plugin"
   *   "@scope/plugin" -> "@scope/plugin"
   *   "@scope/plugin@2.0.0" -> "@scope/plugin"
   */
  private parsePackageName(spec: string): string {
    if (spec.startsWith("@")) {
      // Scoped package: @scope/name[@version]
      const slashIndex = spec.indexOf("/");
      if (slashIndex === -1) return spec;
      const afterSlash = spec.substring(slashIndex + 1);
      const atIndex = afterSlash.indexOf("@");
      if (atIndex === -1) return spec;
      return spec.substring(0, slashIndex + 1 + atIndex);
    }
    // Unscoped package: name[@version]
    const atIndex = spec.indexOf("@");
    if (atIndex === -1) return spec;
    return spec.substring(0, atIndex);
  }
}
