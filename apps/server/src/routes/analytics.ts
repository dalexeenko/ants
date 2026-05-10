/**
 * Analytics API routes
 * Provides dashboard summary, events, and cost breakdown endpoints.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AnalyticsService } from '../services/analytics.js';
import { parseBody, parseBodyOptional } from '../utils/validation.js';
import { TrackEventSchema, CleanupEventsSchema } from '../schemas/index.js';

export function createAnalyticsRoutes(analytics: AnalyticsService) {
  const app = new Hono();

  /**
   * GET /analytics/dashboard
   * Get aggregated dashboard metrics
   */
  app.get('/dashboard', (c) => {
    const projectId = c.req.query('projectId');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');
    const limit = parseInt(c.req.query('limit') || '30', 10);

    const dashboard = analytics.getDashboard({
      projectId: projectId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit,
    });

    return c.json(dashboard);
  });

  /**
   * GET /analytics/events
   * Get raw analytics events with filtering
   */
  app.get('/events', (c) => {
    const projectId = c.req.query('projectId');
    const eventType = c.req.query('eventType');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');
    const limit = parseInt(c.req.query('limit') || '100', 10);

    const events = analytics.getEvents({
      projectId: projectId || undefined,
      eventType: eventType || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit,
    });

    return c.json({ events });
  });

  /**
   * GET /analytics/costs
   * Get cost breakdown by project
   */
  app.get('/costs', (c) => {
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    const costs = analytics.getCostBreakdown(
      startDate || undefined,
      endDate || undefined,
    );

    return c.json({ costs });
  });

  /**
   * POST /analytics/track
   * Manually track an event (for external integrations)
   */
  app.post('/track', async (c) => {
    const body = await parseBody(c, TrackEventSchema);

    analytics.trackEvent(body);
    return c.json({ success: true });
  });

  /**
   * POST /analytics/cleanup
   * Clean up old analytics events
   */
  app.post('/cleanup', async (c) => {
    const body = await parseBodyOptional(c, CleanupEventsSchema, {});
    const olderThanDays = body.olderThanDays ?? 90;

    const deleted = analytics.cleanupOldEvents(olderThanDays);
    return c.json({ deleted, olderThanDays });
  });

  return app;
}
