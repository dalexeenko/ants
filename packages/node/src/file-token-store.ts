/**
 * Filesystem-based OAuth token store for Node.js.
 * 
 * Stores OAuth tokens in the XDG config directory (~/.config/openmgr/).
 */

import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { OAuthTokens, OAuthTokenStore } from "@openmgr/agent-auth-anthropic";

/**
 * Default paths for auth files
 */
export function getDefaultAuthPaths() {
  const authDir = join(homedir(), ".config", "openmgr");
  const authFile = join(authDir, "anthropic-oauth.json");
  return { authDir, authFile };
}

interface StoredAuth {
  type: "oauth";
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/**
 * Node.js token store using filesystem.
 * 
 * Stores OAuth tokens in JSON format at ~/.config/openmgr/anthropic-oauth.json
 * 
 * @example
 * ```ts
 * import { FileTokenStore } from "@openmgr/agent-node";
 * import { isLoggedIn, login } from "@openmgr/agent-auth-anthropic";
 * 
 * const tokenStore = new FileTokenStore();
 * 
 * if (await isLoggedIn(tokenStore)) {
 *   console.log("Already logged in");
 * }
 * ```
 */
export class FileTokenStore implements OAuthTokenStore {
  private authDir: string;
  private authFile: string;

  constructor(options?: { authDir?: string; authFile?: string }) {
    const defaults = getDefaultAuthPaths();
    this.authDir = options?.authDir ?? defaults.authDir;
    this.authFile = options?.authFile ?? defaults.authFile;
  }

  async loadTokens(): Promise<OAuthTokens | null> {
    try {
      if (!existsSync(this.authFile)) return null;
      const content = await readFile(this.authFile, "utf-8");
      const stored: StoredAuth = JSON.parse(content);
      if (stored.type !== "oauth") return null;
      return {
        accessToken: stored.access_token,
        refreshToken: stored.refresh_token,
        expiresAt: stored.expires_at,
      };
    } catch {
      return null;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await mkdir(this.authDir, { recursive: true });
    const stored: StoredAuth = {
      type: "oauth",
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
    };
    await writeFile(this.authFile, JSON.stringify(stored, null, 2), "utf-8");
  }

  async clearTokens(): Promise<void> {
    await unlink(this.authFile).catch(() => {});
  }
}
