import { randomBytes } from 'crypto';
import { existsSync, writeFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ensureDirectory, readJsonFile } from './utils/fs.js';
import { DEFAULT_PORT, DEFAULT_HOST } from './constants.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('config');

export interface ServerConfig {
  /** Bearer token secret. Undefined when Cloudflare Access is the sole auth method. */
  secret?: string;
  encryptionKey: string;
  port: number;
  host: string;
  dataDir: string;
  workspacesDir: string;
  agentPath?: string;
  autoInstallAgent: boolean;
  /** Enable mock agent mode for testing (no real agent needed) */
  mockAgent: boolean;
  /** Allowed CORS origins. Use '*' for all origins (not recommended for production) */
  corsOrigins: string[];
  /** Enable multi-user mode with RBAC (opt-in via OPENMGR_MULTI_USER=true) */
  multiUser: boolean;
  /** One-time setup token required to create the initial admin account.
   *  When set, the POST /setup endpoint requires this token.
   *  When unset, the first person to hit POST /setup claims admin (no token needed). */
  setupToken?: string;
  /** Contact email for VAPID push notifications (mailto: URI) */
  pushContactEmail?: string;
  /** Cloudflare Access team domain, e.g. "https://myteam.cloudflareaccess.com" */
  cfAccessTeamDomain?: string;
  /** Cloudflare Access Application Audience (AUD) tag */
  cfAccessAud?: string;
  /** Set authIdentity from Cloudflare Access JWT email claim (default: true) */
  cfAccessSetIdentity: boolean;
  /** Enable the web app UI at /app (opt-in via OPENMGR_WEB_APP=true, default: false) */
  webApp: boolean;
  /** Allowed Host header values. localhost/127.0.0.1/::1 are always permitted.
   *  Set to ['*'] to allow any host. Empty array = localhost only. */
  allowedHosts: string[];
  /** SQLite journal mode. Defaults to 'wal'. Set to 'delete' when running on
   *  network filesystems (e.g. EFS) where WAL's mmap-based shared memory is
   *  unreliable. */
  sqliteJournalMode: 'wal' | 'delete';
}

function getDefaultDataDir(): string {
  return join(homedir(), '.config', 'openmgr-server');
}

function getDefaultWorkspacesDir(): string {
  return join(homedir(), 'openmgr');
}

function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

function validateEncryptionKey(key: string): void {
  try {
    const decoded = Buffer.from(key, 'base64');
    if (decoded.length !== 32) {
      console.error('Error: OPENMGR_ENCRYPTION_KEY must be 32 bytes (256 bits).');
      console.error('Generate one with: openssl rand -base64 32');
      process.exit(1);
    }
  } catch {
    console.error('Error: OPENMGR_ENCRYPTION_KEY must be valid base64.');
    console.error('Generate one with: openssl rand -base64 32');
    process.exit(1);
  }
}

export function loadConfig(): ServerConfig {
  const encryptionKey = process.env.OPENMGR_ENCRYPTION_KEY;
  
  if (!encryptionKey) {
    console.error('Error: OPENMGR_ENCRYPTION_KEY environment variable is required.');
    console.error('Generate one with: openssl rand -base64 32');
    process.exit(1);
  }
  
  validateEncryptionKey(encryptionKey);

  // When a local .env file is present, treat env vars as the sole config
  // source and don't read or write config.json. This lets developers spin
  // up isolated server instances with different behaviour without
  // polluting (or being polluted by) the global config.
  const hasLocalEnv = existsSync(join(process.cwd(), '.env'));

  const dataDir = process.env.OPENMGR_DATA_DIR || getDefaultDataDir();
  const configPath = join(dataDir, 'config.json');
  
  ensureDirectory(dataDir);
  
  const config: Partial<ServerConfig> = hasLocalEnv ? {} : readJsonFile(configPath, {});

  if (hasLocalEnv) {
    log.info('Local .env detected — ignoring config.json');
  }
  
  // ── Cloudflare Access ────────────────────────────────────────────────
  const cfAccessTeamDomain = process.env.OPENMGR_CF_ACCESS_TEAM_DOMAIN || config.cfAccessTeamDomain;
  const cfAccessAud = process.env.OPENMGR_CF_ACCESS_AUD || config.cfAccessAud;
  const cfAccessSetIdentity = process.env.OPENMGR_CF_ACCESS_SET_IDENTITY !== 'false' &&
    (config.cfAccessSetIdentity !== false);

  const hasCfAccess = !!(cfAccessTeamDomain && cfAccessAud);

  // Validate CF Access — both fields must be set together
  if ((cfAccessTeamDomain && !cfAccessAud) || (!cfAccessTeamDomain && cfAccessAud)) {
    console.error('Error: OPENMGR_CF_ACCESS_TEAM_DOMAIN and OPENMGR_CF_ACCESS_AUD must both be set.');
    process.exit(1);
  }

  // ── Multi-user (must be resolved before secret logic) ────────────────
  const multiUser = process.env.OPENMGR_MULTI_USER === 'true' || config.multiUser === true;

  // ── Secret ───────────────────────────────────────────────────────────
  // In multi-user mode, the shared server secret is NOT used for auth —
  // all authentication goes through per-user credentials. Error if someone
  // explicitly sets a secret while multi-user is enabled.
  const explicitSecret = process.env.OPENMGR_SECRET || config.secret;

  if (multiUser && explicitSecret) {
    console.error('Error: OPENMGR_SECRET cannot be used with multi-user mode.');
    console.error('In multi-user mode, authentication uses per-user credentials.');
    console.error('Remove OPENMGR_SECRET (or the "secret" config field) to continue.');
    process.exit(1);
  }

  // When CF Access is configured, don't auto-generate a secret — bearer
  // auth is only active if the user explicitly provides OPENMGR_SECRET.
  // In multi-user mode, never generate a shared secret.
  const secret = multiUser
    ? undefined
    : (explicitSecret || (hasCfAccess ? undefined : generateSecret()));

  // At least one auth method must be configured (single-user mode only —
  // multi-user mode has password auth built in)
  if (!multiUser && !secret && !hasCfAccess) {
    console.error('Error: No authentication method configured.');
    console.error('Either set OPENMGR_SECRET for bearer token auth, or set both');
    console.error('OPENMGR_CF_ACCESS_TEAM_DOMAIN and OPENMGR_CF_ACCESS_AUD for Cloudflare Access.');
    process.exit(1);
  }

  // ── Other config ─────────────────────────────────────────────────────
  // Port 0 is valid (OS assigns a free port), so use NaN check instead of falsy
  const envPort = parseInt(process.env.OPENMGR_PORT ?? '', 10);
  const port = !isNaN(envPort) ? envPort : (config.port ?? DEFAULT_PORT);
  const host = process.env.OPENMGR_HOST || config.host || DEFAULT_HOST;
  const workspacesDir = process.env.OPENMGR_WORKSPACES_DIR || config.workspacesDir || getDefaultWorkspacesDir();
  const agentPath = process.env.OPENMGR_AGENT_PATH || config.agentPath;
  const autoInstallAgent = process.env.OPENMGR_AUTO_INSTALL_AGENT !== 'false' && 
    (config.autoInstallAgent !== false);
  const mockAgent = process.env.OPENMGR_MOCK_AGENT === 'true' || config.mockAgent === true;
  const setupToken = process.env.OPENMGR_SETUP_TOKEN || config.setupToken || undefined;
  const pushContactEmail = process.env.OPENMGR_PUSH_CONTACT_EMAIL || config.pushContactEmail;
  const webApp = process.env.OPENMGR_WEB_APP === 'true' || (config as any).webApp === true;

  // Parse allowed hosts from env var (comma-separated) or config
  // Default is empty array (localhost-only). Set to '*' to allow any host.
  let allowedHosts: string[];
  if (process.env.OPENMGR_ALLOWED_HOSTS) {
    allowedHosts = process.env.OPENMGR_ALLOWED_HOSTS.split(',').map(h => h.trim().toLowerCase());
  } else if (config.allowedHosts && Array.isArray(config.allowedHosts)) {
    allowedHosts = config.allowedHosts;
  } else {
    allowedHosts = [];
  }

  // SQLite journal mode — WAL by default, but 'delete' is safer on network filesystems (EFS)
  const sqliteJournalModeEnv = process.env.OPENMGR_SQLITE_JOURNAL_MODE?.toLowerCase();
  const sqliteJournalMode: 'wal' | 'delete' =
    sqliteJournalModeEnv === 'delete' ? 'delete' : 'wal';

  // Parse CORS origins from env var (comma-separated) or config, default to localhost only
  const defaultCorsOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  let corsOrigins: string[];
  if (process.env.OPENMGR_CORS_ORIGINS) {
    corsOrigins = process.env.OPENMGR_CORS_ORIGINS.split(',').map(o => o.trim());
  } else if (config.corsOrigins && Array.isArray(config.corsOrigins)) {
    corsOrigins = config.corsOrigins;
  } else {
    corsOrigins = defaultCorsOrigins;
  }
  
  const finalConfig: ServerConfig = {
    secret,
    encryptionKey,
    port,
    host,
    dataDir,
    workspacesDir,
    agentPath,
    autoInstallAgent,
    mockAgent,
    corsOrigins,
    multiUser,
    setupToken,
    pushContactEmail,
    cfAccessTeamDomain,
    cfAccessAud,
    cfAccessSetIdentity,
    webApp,
    allowedHosts,
    sqliteJournalMode,
  };
  
  // Only persist config.json when not using a local .env — this keeps
  // dev instances fully isolated from the global config.
  if (!hasLocalEnv) {
    writeFileSync(configPath, JSON.stringify(finalConfig, null, 2));
    // Set restrictive permissions (owner read/write only) to protect the secret
    try {
      chmodSync(configPath, 0o600);
    } catch {
      log.warn(`Could not set restrictive permissions on ${configPath}`);
    }
  }
  
  ensureDirectory(join(dataDir, 'projects'));
  ensureDirectory(workspacesDir);
  
  return finalConfig;
}
