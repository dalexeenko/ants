/**
 * Service container — creates and wires all services.
 *
 * Takes config + database as input, returns every service instance the
 * application needs.  Keeps src/index.ts thin and focused on bootstrapping.
 */

import { existsSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ServerConfig } from '../config.js';
import type { DrizzleDB } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('container');
import { EncryptionService } from './encryption.js';
import { OpenMgrAgentManager } from './openmgr-agent-manager.js';
import { ProjectManager } from './project-manager.js';
import { TaskScheduler } from './task-scheduler.js';
import { ApiKeyManager } from './api-key-manager.js';
import { TerminalManager } from './terminal-manager.js';
import { ChannelManager } from './channel-manager.js';
import { MessageQueueService } from './message-queue.js';
import { MessageProcessor } from './message-processor.js';
import { AnalyticsService } from './analytics.js';
import { AgentCommsService } from './agent-comms.js';
import { WebhookManager } from './webhook-manager.js';
import { FileWatcherManager } from './file-watcher-manager.js';
import { ApprovalManager } from './approval-manager.js';
import { TemplateManager } from './template-manager.js';
import { PushNotificationService } from './push-notification.js';
import { UserManager } from './user-manager.js';
import { AuditLogger } from './audit-logger.js';
import { WebSessionService } from './web-session.js';
import { AuthCodeService } from './auth-code.js';
import { GroupManager } from './group-manager.js';
import { OAuthService } from './oauth-service.js';
import { PluginRegistry } from './plugin-registry.js';
import { ensureSystemUser } from './system-user.js';
import { SlackAdapter } from '../channels/adapters/slack.js';
import { DiscordAdapter } from '../channels/adapters/discord.js';
import { TelegramAdapter } from '../channels/adapters/telegram.js';
import { worktreeManager } from './worktree-manager.js';
import type { WorktreeLifecycleHooks } from './worktree-manager.js';

export interface Services {
  db: DrizzleDB;
  encryption: EncryptionService;
  apiKeyManager: ApiKeyManager;
  agentManager: OpenMgrAgentManager;
  projectManager: ProjectManager;
  taskScheduler: TaskScheduler;
  terminalManager: TerminalManager;
  channelManager: ChannelManager;
  messageQueue: MessageQueueService;
  messageProcessor: MessageProcessor;
  analytics: AnalyticsService;
  agentComms: AgentCommsService;
  webhookManager: WebhookManager;
  fileWatcherManager: FileWatcherManager;
  approvalManager: ApprovalManager;
  templateManager: TemplateManager;
  pushService: PushNotificationService;
  userManager: UserManager | undefined;
  auditLogger: AuditLogger | undefined;
  webSessionService: WebSessionService;
  authCodeService: AuthCodeService;
  groupManager: GroupManager;
  oauthService: OAuthService;
  pluginRegistry: PluginRegistry;
}

/**
 * One-time migration: import plaintext API keys from the legacy
 * `providers.json` file into the encrypted `ApiKeyManager` store,
 * then rename the file to `.backup` so it is not re-processed.
 */
async function migrateLegacyProviders(
  dataDir: string,
  apiKeyManager: ApiKeyManager,
): Promise<void> {
  const legacyPath = join(dataDir, 'providers.json');
  if (!existsSync(legacyPath)) return;

  try {
    const raw = JSON.parse(readFileSync(legacyPath, 'utf-8')) as Record<
      string,
      { providerId: string; apiKey: string }
    >;

    // Map legacy provider IDs to the primary env var used by ApiKeyManager.
    const definitions = apiKeyManager.getProviderDefinitions();
    let migrated = 0;

    for (const [providerId, cred] of Object.entries(raw)) {
      if (!cred?.apiKey) continue;

      const def = definitions.find(d => d.id === providerId);
      if (!def) continue;

      const primaryEnvVar = def.fields[0]?.envVar;
      if (!primaryEnvVar) continue;

      // Only import if the provider doesn't already have keys in the new store
      const existing = await apiKeyManager.getProviderKeys(providerId);
      const alreadyConfigured = existing && Object.values(existing.keys).some(v => v.isSet);
      if (alreadyConfigured) continue;

      await apiKeyManager.setProviderKeys(providerId, { [primaryEnvVar]: cred.apiKey });
      migrated++;
    }

    renameSync(legacyPath, `${legacyPath}.backup`);
    if (migrated > 0) {
      log.info(`Migrated ${migrated} provider key(s) from providers.json to encrypted store`);
    }
    log.info(`Backed up ${legacyPath} to ${legacyPath}.backup`);
  } catch (error) {
    log.error('Failed to migrate legacy provider credentials:', error);
  }
}

/**
 * One-time migration: import OAuth credentials from the legacy plaintext
 * `~/.local/share/openmgr/auth.json` file into the encrypted database,
 * then rename the file to `.backup` so it is not re-processed.
 */
async function migrateLegacyAuthJson(
  apiKeyManager: ApiKeyManager,
): Promise<void> {
  const legacyPath = join(homedir(), '.local', 'share', 'openmgr', 'auth.json');
  if (!existsSync(legacyPath)) return;

  try {
    const raw = JSON.parse(readFileSync(legacyPath, 'utf-8')) as Record<string, unknown>;
    let migrated = 0;

    for (const [providerId, cred] of Object.entries(raw)) {
      if (!cred || typeof cred !== 'object') continue;
      const credObj = cred as Record<string, unknown>;

      // Skip if this provider already has OAuth in the DB
      const existing = await apiKeyManager.getOAuthCredentials(providerId);
      if (existing) continue;

      if (credObj.type === 'oauth' && typeof credObj.refresh === 'string') {
        await apiKeyManager.setOAuthCredentials(providerId, {
          refresh: credObj.refresh as string,
          access: (credObj.access as string) || '',
          expires: (credObj.expires as number) || 0,
          accountId: (credObj.accountId as string) || undefined,
        });
        migrated++;
      }
    }

    renameSync(legacyPath, `${legacyPath}.backup`);
    if (migrated > 0) {
      log.info(`Migrated ${migrated} OAuth credential(s) from auth.json to encrypted store`);
    }
    log.info(`Backed up ${legacyPath} to ${legacyPath}.backup`);
  } catch (error) {
    log.error('Failed to migrate legacy auth.json:', error);
  }
}

export async function createServices(config: ServerConfig, db: DrizzleDB): Promise<Services> {
  const encryption = new EncryptionService(config.encryptionKey);

  const apiKeyManager = new ApiKeyManager(db, encryption);

  // Migrate legacy plaintext providers.json → encrypted store
  await migrateLegacyProviders(config.dataDir, apiKeyManager);

  // Migrate legacy plaintext auth.json → encrypted store
  await migrateLegacyAuthJson(apiKeyManager);

  const agentManager = new OpenMgrAgentManager(config, apiKeyManager);

  // Wire worktree lifecycle hooks to Docker manager for future per-worktree containers.
  // Currently the server spawns one agent-server per project; these hooks log
  // worktree lifecycle events and provide the integration point for when
  // per-worktree Docker containers are implemented.
  const dockerManager = agentManager.getDockerManager();
  const worktreeHooks: WorktreeLifecycleHooks = {
    async onWorktreeCreated(projectDir, worktree) {
      log.debug(`Worktree created in ${projectDir}: ${worktree.id} (branch: ${worktree.branch})`);
      // Future: start a Docker container for this worktree if Docker is enabled
    },
    async onWorktreeRemoving(projectDir, worktree) {
      log.debug(`Worktree removing in ${projectDir}: ${worktree.id}`);
      // Future: stop the Docker container for this worktree
      try {
        await dockerManager.stopContainer(worktree.path);
      } catch {
        // Container may not exist (non-Docker project)
      }
    },
  };
  worktreeManager.setHooks(worktreeHooks);

  const projectManager = new ProjectManager(config, agentManager, db);

  // Push notification service (created early so it can be passed to other services)
  const pushService = new PushNotificationService(db, config.dataDir, config.pushContactEmail);

  const taskScheduler = new TaskScheduler(projectManager, db, pushService);
  const terminalManager = new TerminalManager();

  // Channel management
  const channelManager = new ChannelManager(db, encryption);
  const messageQueue = new MessageQueueService(db);
  const messageProcessor = new MessageProcessor(channelManager, messageQueue, projectManager);

  // Analytics
  const analytics = new AnalyticsService(db);

  // Agent-to-agent communication
  const agentComms = new AgentCommsService(db, projectManager);

  // Webhooks & file watchers
  const webhookManager = new WebhookManager(db, projectManager);
  const fileWatcherManager = new FileWatcherManager(db, projectManager);

  // Approval workflows
  const approvalManager = new ApprovalManager(db);
  approvalManager.createDefaultRules();

  // Wire approval requests to push notifications
  approvalManager.on('approval:requested', (data: { id: string; projectId: string; sessionId?: string; toolName: string }) => {
    pushService.notifyApprovalNeeded(data.projectId, data.toolName, data.id, data.sessionId || undefined).catch((e) => {
      log.warn('Failed to send approval push notification:', e);
    });
  });

  // Template manager
  const templateManager = new TemplateManager(db, projectManager);
  templateManager.ensureBuiltinTemplates();

  // System user — always exists, owns objects in single-user mode
  await ensureSystemUser(db);

  // Web session service (cookie-based auth for server web UI)
  const webSessionService = new WebSessionService(db);

  // Auth code service (one-time codes for app auth flow)
  const authCodeService = new AuthCodeService(db);

  // Group manager
  const groupManager = new GroupManager(db);

  // OAuth service (social auth)
  const oauthService = new OAuthService(db, encryption);

  // Plugin registry (server-level plugin list + per-project overrides)
  const pluginRegistry = new PluginRegistry(db);
  projectManager.setPluginRegistry(pluginRegistry);

  // Multi-user support (conditionally)
  let userManager: UserManager | undefined;
  let auditLogger: AuditLogger | undefined;

  if (config.multiUser) {
    userManager = new UserManager(db);
    auditLogger = new AuditLogger(db);

    if (userManager.needsSetup()) {
      log.info('Multi-user mode enabled — setup required (no admin user exists)');
    } else {
      log.info('Multi-user mode enabled');
    }

    // Enable project-access filtering on push notifications
    pushService.setMultiUserMode(true, (userId, projectId) => {
      return groupManager.getEffectiveRole(userId, projectId);
    });
  }

  // Register channel adapters
  channelManager.registerAdapter(new SlackAdapter());
  channelManager.registerAdapter(new DiscordAdapter());
  channelManager.registerAdapter(new TelegramAdapter());

  return {
    db,
    encryption,
    apiKeyManager,
    agentManager,
    projectManager,
    taskScheduler,
    terminalManager,
    channelManager,
    messageQueue,
    messageProcessor,
    analytics,
    agentComms,
    webhookManager,
    fileWatcherManager,
    approvalManager,
    templateManager,
    pushService,
    userManager,
    auditLogger,
    webSessionService,
    authCodeService,
    groupManager,
    oauthService,
    pluginRegistry,
  };
}
