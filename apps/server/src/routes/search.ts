import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { ProjectManager } from '../services/project-manager.js';
import type { SearchSessionsParams, SearchMessagesParams } from '../services/ants-agent-manager.js';
import { getErrorMessage } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('search');

/**
 * Search routes — fan out queries to agent-servers per project.
 *
 * Each project has its own agent-server with its own session database.
 * Global search fans out queries to all running agent-servers in parallel
 * and merges the results.
 *
 * Endpoints:
 * - GET /search/sessions - Search sessions across all projects
 * - GET /search/messages - Search messages across all projects
 * - GET /search/messages/stream - Search messages with streaming results
 */
export function createSearchRoutes(projectManager: ProjectManager) {
  const app = new Hono();

  /**
   * Search sessions across all projects.
   *
   * Query parameters:
   * - q: Free-text search query (searches title, working directory, and optionally messages)
   * - provider: Filter by provider (e.g., "anthropic")
   * - model: Filter by model
   * - workingDirectory: Filter by working directory
   * - includeMessages: Include message content in search (default: false)
   * - rootOnly: Only return root sessions (default: false)
   * - limit: Maximum results (default: 50)
   * - offset: Pagination offset (default: 0)
   * - orderBy: Sort by field (createdAt, updatedAt, messageCount, tokenEstimate)
   * - orderDirection: Sort direction (asc, desc)
   */
  app.get('/sessions', async (c) => {
    const query = c.req.query('q');
    const provider = c.req.query('provider');
    const model = c.req.query('model');
    const workingDirectory = c.req.query('workingDirectory');
    const includeMessages = c.req.query('includeMessages') === 'true';
    const rootOnly = c.req.query('rootOnly') === 'true';
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    const orderBy = c.req.query('orderBy') as SearchSessionsParams['orderBy'];
    const orderDirection = c.req.query('orderDirection') as SearchSessionsParams['orderDirection'];

    const params: SearchSessionsParams = {
      query: query || undefined,
      provider: provider || undefined,
      model: model || undefined,
      workingDirectory: workingDirectory || undefined,
      includeMessages,
      rootOnly,
      limit,
      offset,
      orderBy: orderBy || 'updatedAt',
      orderDirection: orderDirection || 'desc',
    };

    try {
      const projects = await projectManager.listProjects();

      // Fan out search to all agent-servers in parallel
      const searchPromises = projects.map(async (project) => {
        try {
          const client = await projectManager.getClient(project.id);
          if (!client) return [];
          const result = await client.searchSessions(params);
          return result.results;
        } catch (e) {
          log.warn(`Failed to search sessions for project ${project.name}:`, getErrorMessage(e));
          return [];
        }
      });

      const allResults = (await Promise.all(searchPromises)).flat();

      // Sort merged results by the requested orderBy field
      // The individual agent-servers return sorted results, but we need to re-sort the merged set
      const sortField = params.orderBy || 'updatedAt';
      const sortDir = params.orderDirection === 'asc' ? 1 : -1;
      allResults.sort((a: unknown, b: unknown) => {
        const aSession = (a as { session?: Record<string, unknown> }).session || a as Record<string, unknown>;
        const bSession = (b as { session?: Record<string, unknown> }).session || b as Record<string, unknown>;
        const aVal = aSession[sortField];
        const bVal = bSession[sortField];
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortDir * aVal.localeCompare(bVal);
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDir * (aVal - bVal);
        }
        return 0;
      });

      // Apply global pagination (offset/limit across merged results)
      const paged = allResults.slice(offset, offset + limit);

      return c.json({
        results: paged,
        pagination: {
          limit,
          offset,
          count: paged.length,
        },
      });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  /**
   * Search messages across all projects.
   *
   * Query parameters:
   * - q: Search query (required)
   * - sessionId: Filter by session ID
   * - role: Filter by role (user, assistant)
   * - limit: Maximum results (default: 100)
   * - offset: Pagination offset (default: 0)
   */
  app.get('/messages', async (c) => {
    const query = c.req.query('q');
    if (!query) {
      return c.json({ error: 'Query parameter "q" is required' }, 400);
    }

    const sessionId = c.req.query('sessionId');
    const role = c.req.query('role') as 'user' | 'assistant' | undefined;
    const limit = parseInt(c.req.query('limit') ?? '100', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const params: SearchMessagesParams = {
      query,
      sessionId: sessionId || undefined,
      role: role || undefined,
      limit,
      offset,
    };

    try {
      const projects = await projectManager.listProjects();

      // Fan out search to all agent-servers in parallel
      const searchPromises = projects.map(async (project) => {
        try {
          const client = await projectManager.getClient(project.id);
          if (!client) return [];
          const result = await client.searchMessages(params);
          return result.results;
        } catch (e) {
          log.warn(`Failed to search messages for project ${project.name}:`, getErrorMessage(e));
          return [];
        }
      });

      const allResults = (await Promise.all(searchPromises)).flat();

      // Apply global pagination
      const paged = allResults.slice(offset, offset + limit);

      return c.json({
        results: paged,
        pagination: {
          limit,
          offset,
          count: paged.length,
        },
      });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  /**
   * Search messages with streaming results.
   *
   * Returns Server-Sent Events (SSE) stream with results as they are found.
   * Each event is a JSON object with the search result.
   * Results arrive per-project as each agent-server responds.
   *
   * Query parameters: Same as /messages
   */
  app.get('/messages/stream', async (c) => {
    const query = c.req.query('q');
    if (!query) {
      return c.json({ error: 'Query parameter "q" is required' }, 400);
    }

    const sessionId = c.req.query('sessionId');
    const role = c.req.query('role') as 'user' | 'assistant' | undefined;
    const limit = parseInt(c.req.query('limit') ?? '100', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const params: SearchMessagesParams = {
      query,
      sessionId: sessionId || undefined,
      role: role || undefined,
      limit,
      offset,
    };

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Accel-Buffering', 'no');

    return stream(c, async (streamWriter) => {
      try {
        const projects = await projectManager.listProjects();
        let totalCount = 0;

        // Fan out to all agent-servers in parallel, stream results as they arrive
        const searchPromises = projects.map(async (project) => {
          try {
            const client = await projectManager.getClient(project.id);
            if (!client) return;
            const result = await client.searchMessages(params);
            for (const item of result.results) {
              await streamWriter.write(`data: ${JSON.stringify(item)}\n\n`);
              totalCount++;
            }
          } catch (e) {
            log.warn(`Failed to stream messages for project ${project.name}:`, getErrorMessage(e));
          }
        });

        await Promise.all(searchPromises);

        // Send done event
        await streamWriter.write(`data: ${JSON.stringify({ type: 'done', count: totalCount })}\n\n`);
      } catch (e) {
        await streamWriter.write(`data: ${JSON.stringify({ type: 'error', error: getErrorMessage(e) })}\n\n`);
      }
    });
  });

  return app;
}
