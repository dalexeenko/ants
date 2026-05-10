import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAnalyticsRoutes } from './analytics.js';
import type { AnalyticsService } from '../services/analytics.js';

describe('analytics routes', () => {
  let app: Hono;
  let mockAnalytics: Partial<AnalyticsService>;

  const testDashboard = {
    totalSessions: 50,
    totalTokens: 100000,
    totalCost: 12.5,
    dailyBreakdown: [],
  };

  const testEvents = [
    { id: 'ev-1', eventType: 'session.start', projectId: 'proj-1', timestamp: '2024-01-01' },
    { id: 'ev-2', eventType: 'session.end', projectId: 'proj-1', timestamp: '2024-01-02' },
  ];

  const testCosts = [
    { projectId: 'proj-1', projectName: 'Test', totalCost: 5.0, totalTokens: 50000 },
  ];

  beforeEach(() => {
    mockAnalytics = {
      getDashboard: vi.fn().mockReturnValue(testDashboard),
      getEvents: vi.fn().mockReturnValue(testEvents),
      getCostBreakdown: vi.fn().mockReturnValue(testCosts),
      trackEvent: vi.fn(),
      cleanupOldEvents: vi.fn().mockReturnValue(10),
    };

    app = new Hono();
    const routes = createAnalyticsRoutes(mockAnalytics as AnalyticsService);
    app.route('/analytics', routes);
  });

  describe('GET /analytics/dashboard', () => {
    it('should return dashboard metrics', async () => {
      const res = await app.request('/analytics/dashboard');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalSessions).toBe(50);
      expect(body.totalTokens).toBe(100000);
    });

    it('should pass query params to getDashboard', async () => {
      await app.request('/analytics/dashboard?projectId=proj-1&startDate=2024-01-01&endDate=2024-01-31&limit=7');

      expect(mockAnalytics.getDashboard).toHaveBeenCalledWith({
        projectId: 'proj-1',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        limit: 7,
      });
    });

    it('should use default limit of 30', async () => {
      await app.request('/analytics/dashboard');

      expect(mockAnalytics.getDashboard).toHaveBeenCalledWith({
        projectId: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: 30,
      });
    });
  });

  describe('GET /analytics/events', () => {
    it('should return analytics events', async () => {
      const res = await app.request('/analytics/events');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toHaveLength(2);
    });

    it('should pass query params to getEvents', async () => {
      await app.request('/analytics/events?projectId=proj-1&eventType=session.start&startDate=2024-01-01&endDate=2024-01-31&limit=10');

      expect(mockAnalytics.getEvents).toHaveBeenCalledWith({
        projectId: 'proj-1',
        eventType: 'session.start',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        limit: 10,
      });
    });

    it('should use default limit of 100', async () => {
      await app.request('/analytics/events');

      expect(mockAnalytics.getEvents).toHaveBeenCalledWith({
        projectId: undefined,
        eventType: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: 100,
      });
    });
  });

  describe('GET /analytics/costs', () => {
    it('should return cost breakdown', async () => {
      const res = await app.request('/analytics/costs');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.costs).toHaveLength(1);
      expect(body.costs[0].totalCost).toBe(5.0);
    });

    it('should pass date params to getCostBreakdown', async () => {
      await app.request('/analytics/costs?startDate=2024-01-01&endDate=2024-01-31');

      expect(mockAnalytics.getCostBreakdown).toHaveBeenCalledWith('2024-01-01', '2024-01-31');
    });

    it('should use undefined when no date params', async () => {
      await app.request('/analytics/costs');

      expect(mockAnalytics.getCostBreakdown).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('POST /analytics/track', () => {
    it('should track an event', async () => {
      const res = await app.request('/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'prompt', projectId: 'proj-1' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockAnalytics.trackEvent).toHaveBeenCalledWith({
        eventType: 'prompt',
        projectId: 'proj-1',
      });
    });

    it('should return 400 when eventType is missing', async () => {
      const res = await app.request('/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-1' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('eventType');
    });
  });

  describe('POST /analytics/cleanup', () => {
    it('should clean up old events with specified days', async () => {
      const res = await app.request('/analytics/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays: 30 }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(10);
      expect(body.olderThanDays).toBe(30);
      expect(mockAnalytics.cleanupOldEvents).toHaveBeenCalledWith(30);
    });

    it('should default to 90 days when not specified', async () => {
      const res = await app.request('/analytics/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.olderThanDays).toBe(90);
      expect(mockAnalytics.cleanupOldEvents).toHaveBeenCalledWith(90);
    });
  });
});
