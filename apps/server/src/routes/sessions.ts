import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ProjectManager } from '../services/project-manager.js';
import { fetchModelsFromApi } from '../services/models-api.js';
import { worktreeManager } from '../services/worktree-manager.js';
import { getErrorMessage } from '../utils/errors.js';
import { parseBody, parseBodyOptional } from '../utils/validation.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sessions');
import type { AuthUser } from '../auth/provider.js';
import {
  CreateSessionSchema,
  PromptSchema,
  PermissionResponseSchema,
  QuestionResponseSchema,
  CreateBranchSchema,
  RollbackSchema,
} from '../schemas/index.js';

/**
 * Session routes — CRUD, messages, prompt (non-streaming), branches, rollback.
 *
 * The agent-server is the single source of truth for all session data —
 * both session metadata (create, get, list, delete) and messages.
 * The ants server proxies all session CRUD operations to the agent-server.
 *
 * Streaming endpoints (prompt/stream, SSE events, status, abort) live in
 * session-streaming.ts.
 */
export function createSessionRoutes(projectManager: ProjectManager) {
  const app = new Hono();

  // List sessions for a project (proxied to agent-server)
  app.get('/:projectId/sessions', async (c) => {
    const projectId = c.req.param('projectId');
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json([], 200);
      }
      // Agent-server returns all root sessions; filter by workingDirectory
      const allSessions = await agentClient.listSessions(limit) as Array<{ workingDirectory?: string }>;
      const projectSessions = allSessions.filter(
        s => s.workingDirectory === project.workingDirectory
      );
      return c.json(projectSessions);
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Delete all sessions for a project (proxied to agent-server)
  app.delete('/:projectId/sessions', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent server not available' }, 503);
      }
      const result = await agentClient.deleteAllSessions();
      return c.json({ success: true, deletedCount: result.deletedCount });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Create session (proxied to agent-server)
  app.post('/:projectId/sessions', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const body = await parseBodyOptional(c, CreateSessionSchema, {});
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Failed to start agent server' }, 500);
      }

      let workingDirectory = project.workingDirectory;
      let worktreeInfo = null;

      // Handle worktree creation (only if worktree is enabled for the project)
      if (body.useWorktree && project.worktreeEnabled) {
        try {
          const worktree = await worktreeManager.createWorktree(project.workingDirectory);
          if (body.worktreeBranch) {
            await worktreeManager.renameWorktreeBranch(project.workingDirectory, worktree.id, body.worktreeBranch);
          }
          workingDirectory = worktree.path;
          worktreeInfo = {
            id: worktree.id,
            branch: worktree.branch,
            baseBranch: worktree.baseBranch,
            path: worktree.path,
            status: 'active',
          };
        } catch (wtErr) {
          log.error('Failed to create worktree:', wtErr);
          // Fall through — create session without worktree
        }
      }

      const user = (c as any).get('user') as AuthUser | undefined;
      const session = await agentClient.createSession({
        workingDirectory,
        title: body.title,
        parentId: body.parentId,
        mode: body.mode,
        userId: user?.id || 'system',
      }) as Record<string, unknown>;

      // Associate worktree with session
      if (worktreeInfo) {
        await worktreeManager.associateSession(project.workingDirectory, worktreeInfo.id, session.id as string);
        return c.json({ ...session, worktree: worktreeInfo }, 201);
      }

      return c.json(session, 201);
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Get worktree diff for a session
  app.get('/:projectId/sessions/:sessionId/worktree/diff', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const diffResult = await worktreeManager.diffBySession(project.workingDirectory, sessionId);
      if (!diffResult) {
        return c.json({ error: 'No worktree found for this session' }, 404);
      }

      return c.json(diffResult);
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Merge worktree branch back into base branch
  app.post('/:projectId/sessions/:sessionId/worktree/merge', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const result = await worktreeManager.mergeBySession(project.workingDirectory, sessionId);
      if (!result.success) {
        return c.json(result, result.message.includes('not found') ? 404 : 500);
      }
      return c.json(result);
    } catch (e) {
      return c.json({ success: false, message: getErrorMessage(e) }, 500);
    }
  });

  // Discard worktree (remove without merging)
  app.post('/:projectId/sessions/:sessionId/worktree/discard', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const result = await worktreeManager.discardBySession(project.workingDirectory, sessionId);
      if (!result.success) {
        return c.json(result, result.message.includes('not found') ? 404 : 500);
      }
      return c.json(result);
    } catch (e) {
      return c.json({ success: false, message: getErrorMessage(e) }, 500);
    }
  });

  // Get session (proxied to agent-server)
  app.get('/:projectId/sessions/:sessionId', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent server not available' }, 503);
      }
      const session = await agentClient.getSession(sessionId);
      if (!session) {
        return c.json({ error: 'Session not found' }, 404);
      }
      return c.json(session);
    } catch (e) {
      const message = getErrorMessage(e);
      if (message.includes('404')) {
        return c.json({ error: 'Session not found' }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // Delete session (proxied to agent-server)
  app.delete('/:projectId/sessions/:sessionId', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent server not available' }, 503);
      }
      await agentClient.deleteSession(sessionId);
      return c.json({ success: true });
    } catch (e) {
      const message = getErrorMessage(e);
      if (message.includes('404')) {
        return c.json({ error: 'Session not found' }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // Get session mode (proxied to agent-server)
  app.get('/:projectId/sessions/:sessionId/mode', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent server not available' }, 503);
      }
      const result = await agentClient.getSessionMode(sessionId);
      return c.json(result);
    } catch (e) {
      return c.json({ mode: 'build' });
    }
  });

  // Set session mode (proxied to agent-server)
  app.put('/:projectId/sessions/:sessionId/mode', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      const body = await c.req.json();
      const mode = body.mode;
      if (mode !== 'plan' && mode !== 'build') {
        return c.json({ error: "Invalid mode. Must be 'plan' or 'build'" }, 400);
      }
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent server not available' }, 503);
      }
      const result = await agentClient.setSessionMode(sessionId, mode);
      return c.json(result);
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Get session messages (proxied to agent-server — the single source of truth)
  // Supports optional pagination via ?limit=N&beforeSequence=M query params.
  app.get('/:projectId/sessions/:sessionId/messages', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent server not available' }, 503);
      }

      const limitParam = c.req.query('limit');
      if (limitParam) {
        const limit = parseInt(limitParam, 10);
        if (isNaN(limit) || limit < 1) {
          return c.json({ error: 'limit must be a positive integer' }, 400);
        }
        const beforeSequenceParam = c.req.query('beforeSequence');
        const beforeSequence = beforeSequenceParam
          ? parseInt(beforeSequenceParam, 10)
          : undefined;
        if (beforeSequenceParam && (isNaN(beforeSequence!) || beforeSequence! < 0)) {
          return c.json({ error: 'beforeSequence must be a non-negative integer' }, 400);
        }

        const result = await agentClient.getMessagesPaginated(sessionId, limit, beforeSequence);
        return c.json({ messages: result.messages, hasMore: result.hasMore });
      }

      const result = await agentClient.getMessages(sessionId) as { messages?: unknown[] };
      return c.json(result.messages || []);
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Send prompt to session (non-streaming)
  // The agent-server stores messages internally; we don't duplicate them.
  app.post('/:projectId/sessions/:sessionId/prompt', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      const body = await parseBody(c, PromptSchema);

      const project = await projectManager.getProject(projectId);
      if (!project) {
        return c.json({ error: 'Project not found' }, 404);
      }

      // Get or start the agent server for this project
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Failed to start agent server' }, 500);
      }
      
      // Ensure session exists on agent server
      try {
        await agentClient.getSession(sessionId);
      } catch {
        const promptUser = (c as any).get('user') as AuthUser | undefined;
        log.info(`Creating session ${sessionId} on agent server`);
        await agentClient.createSession({
          id: sessionId,
          workingDirectory: project.workingDirectory,
          userId: promptUser?.id || 'system',
        });
      }
      
      // Send the prompt - agent-server handles message storage
      log.info(`Sending prompt to agent for session ${sessionId}`);
      const result = await agentClient.sendPromptAsync(sessionId, body.prompt) as {
        status?: string;
        success?: boolean;
        message?: string;
        error?: string;
      };
      
      log.debug(`Agent response:`, JSON.stringify(result).substring(0, 200));
      
      return c.json({ 
        success: result.success ?? true, 
        response: result.message,
        status: result.status,
      });
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const message = getErrorMessage(e);
      log.error('Failed to send prompt:', message);
      
      if (message.includes('No provider available') || message.includes('Register a provider')) {
        return c.json({ 
          error: 'No AI provider configured. Please go to Server Settings and sign in with Anthropic or add an API key.',
          code: 'NO_PROVIDER',
        }, 400);
      }
      
      if (message.includes('invalid_api_key') || message.includes('Invalid API Key') || message.includes('401')) {
        return c.json({ 
          error: 'Invalid API key. Please check your API key in Server Settings.',
          code: 'INVALID_API_KEY',
        }, 401);
      }
      
      if (message.includes('rate_limit') || message.includes('429')) {
        return c.json({ 
          error: 'Rate limit exceeded. Please wait a moment and try again.',
          code: 'RATE_LIMITED',
        }, 429);
      }
      
      if (message.includes('insufficient_quota') || message.includes('billing')) {
        return c.json({ 
          error: 'API quota exceeded or billing issue. Please check your account.',
          code: 'QUOTA_EXCEEDED',
        }, 402);
      }
      
      return c.json({ error: message }, 500);
    }
  });

  // Respond to a tool permission request (proxy to agent-server)
  app.post('/:projectId/sessions/:sessionId/permission/:toolCallId/respond', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const toolCallId = c.req.param('toolCallId');

    try {
      const body = await parseBody(c, PermissionResponseSchema);

      const project = await projectManager.getProject(projectId);
      if (!project) {
        return c.json({ error: 'Project not found' }, 404);
      }

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent not running' }, 503);
      }

      const result = await agentClient.respondToPermission(sessionId, toolCallId, body.response);
      return c.json(result);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Respond to a question request (proxy to agent-server)
  app.post('/:projectId/sessions/:sessionId/question/:questionId/respond', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const questionId = c.req.param('questionId');

    try {
      const body = await parseBody(c, QuestionResponseSchema);

      const project = await projectManager.getProject(projectId);
      if (!project) {
        return c.json({ error: 'Project not found' }, 404);
      }

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent not running' }, 503);
      }

      const result = await agentClient.respondToQuestion(sessionId, questionId, body);
      return c.json(result);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Get providers
  app.get('/:projectId/providers', async (c) => {
    try {
      const providers = await fetchModelsFromApi();
      return c.json(providers.map(p => ({
        id: p.id,
        name: p.name,
        models: p.models.map(m => m.id),
      })));
    } catch (e) {
      log.error('Failed to fetch providers:', e);
      return c.json([
        { id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-20250514'] },
        { id: 'openai', name: 'OpenAI', models: ['gpt-4o'] },
      ]);
    }
  });

  // ==== Session Branching ====

  // List branches for a session
  app.get('/:projectId/sessions/:sessionId/branches', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      const project = await projectManager.getProject(projectId);
      if (!project) return c.json({ error: 'Project not found' }, 404);

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) return c.json({ error: 'Agent not running' }, 503);

      const branches = await agentClient.getBranches(sessionId);
      return c.json({ branches: branches || [] });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Create a new branch at a specific message
  app.post('/:projectId/sessions/:sessionId/branches', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      const body = await parseBody(c, CreateBranchSchema);

      const project = await projectManager.getProject(projectId);
      if (!project) return c.json({ error: 'Project not found' }, 404);

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) return c.json({ error: 'Agent not running' }, 503);

      const branch = await agentClient.createBranch(sessionId, body.name, body.messageId);
      return c.json(branch, 201);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Switch to a branch
  app.post('/:projectId/sessions/:sessionId/branches/:branchId/switch', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const branchId = c.req.param('branchId');

    try {
      const project = await projectManager.getProject(projectId);
      if (!project) return c.json({ error: 'Project not found' }, 404);

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) return c.json({ error: 'Agent not running' }, 503);

      await agentClient.switchBranch(sessionId, branchId);
      return c.json({ success: true, activeBranch: branchId });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Delete a branch
  app.delete('/:projectId/sessions/:sessionId/branches/:branchId', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const branchId = c.req.param('branchId');

    try {
      const project = await projectManager.getProject(projectId);
      if (!project) return c.json({ error: 'Project not found' }, 404);

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) return c.json({ error: 'Agent not running' }, 503);

      await agentClient.deleteBranch(sessionId, branchId);
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Rollback N messages in current branch
  app.post('/:projectId/sessions/:sessionId/rollback', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      const body = await parseBody(c, RollbackSchema);
      const count = body.count ?? 1;

      const project = await projectManager.getProject(projectId);
      if (!project) return c.json({ error: 'Project not found' }, 404);

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) return c.json({ error: 'Agent not running' }, 503);

      await agentClient.rollback(sessionId, count);

      // Get updated message count from agent-server
      const result = await agentClient.getMessages(sessionId) as { messages?: unknown[] };
      return c.json({ success: true, messageCount: result.messages?.length || 0 });
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Get available models for a project (flat list with metadata)
  app.get('/:projectId/models', async (c) => {
    try {
      const providers = await fetchModelsFromApi();
      const models = providers.flatMap(p => p.models);
      return c.json({ models });
    } catch (e) {
      log.error('Failed to fetch models:', e);
      return c.json({ models: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', description: 'Latest Claude model' },
      ]});
    }
  });

  return app;
}
