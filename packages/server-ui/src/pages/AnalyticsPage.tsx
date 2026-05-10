import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

/* -- Types (matching server DashboardSummary) -------------------- */

interface DashboardMetrics {
  totalPrompts: number;
  totalToolCalls: number;
  totalTaskRuns: number;
  taskSuccessRate: number;
  totalTokens: number;
  totalCostUsd: number;
  avgResponseMs: number;
  uniqueSessions: number;
  topModels: Array<{ model: string; count: number; costUsd: number }>;
  topTools: Array<{ tool: string; count: number; avgDurationMs: number }>;
  dailyMetrics: Array<{ date: string; prompts: number; tokens: number; costUsd: number; errors: number }>;
  recentErrors: Array<{ id: string; projectId?: string | null; sessionId?: string | null; errorMessage?: string | null; createdAt: string }>;
}

interface AnalyticsEvent {
  id: string;
  eventType: string;
  projectId: string | null;
  sessionId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

interface CostBreakdown {
  projectId: string;
  projectName: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
}

/* -- Component --------------------------------------------------- */

export function AnalyticsPage() {
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [costs, setCosts] = useState<CostBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'events' | 'costs'>('dashboard');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const loadDashboard = useCallback(async () => {
    try {
      const data = await api.get<DashboardMetrics>('/analytics/dashboard');
      setDashboard(data);
    } catch {
      // ignore
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const data = await api.get<{ events: AnalyticsEvent[] }>('/analytics/events?limit=50');
      setEvents(data.events ?? []);
    } catch {
      // ignore
    }
  }, []);

  const loadCosts = useCallback(async () => {
    try {
      const data = await api.get<{ costs: CostBreakdown[] }>('/analytics/costs');
      setCosts(data.costs ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    Promise.all([loadDashboard(), loadEvents(), loadCosts()]).finally(() =>
      setLoading(false),
    );
  }, [loadDashboard, loadEvents, loadCosts]);

  const handleCleanup = async () => {
    setCleanupLoading(true);
    try {
      const result = await api.post<{ deleted: number; olderThanDays: number }>(
        '/analytics/cleanup',
        { olderThanDays: 90 },
      );
      flashStatus('success', `Cleaned up ${result.deleted} events older than ${result.olderThanDays} days`);
      await Promise.all([loadDashboard(), loadEvents(), loadCosts()]);
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      setCleanupLoading(false);
    }
  };

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1>Analytics</h1>
          <p>Usage metrics and cost tracking</p>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading analytics...</span>
        </div>
      </>
    );
  }

  return (
    <div data-testid="server-ui-analytics">
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h1>Analytics</h1>
            <p>Usage metrics and cost tracking</p>
          </div>
          <button
            className="btn"
            onClick={handleCleanup}
            disabled={cleanupLoading}
            data-testid="server-ui-analytics-cleanup"
          >
            {cleanupLoading ? 'Cleaning...' : 'Clean Up Old Events'}
          </button>

        </div>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {/* Tabs */}
      <div className="tabs" data-testid="server-ui-analytics-tabs">
        {(['dashboard', 'events', 'costs'] as const).map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && dashboard && (
        <div className="section">
          <div className="stats-grid">
            <div className="card">
              <div className="card-row">
                <div className="card-info">
                  <strong>Total Prompts</strong>
                  <span className="text-muted">{(dashboard.totalPrompts ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-row">
                <div className="card-info">
                  <strong>Total Tokens</strong>
                  <span className="text-muted">{(dashboard.totalTokens ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-row">
                <div className="card-info">
                  <strong>Total Cost</strong>
                  <span className="text-muted">${(dashboard.totalCostUsd ?? 0).toFixed(4)}</span>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-row">
                <div className="card-info">
                  <strong>Tool Calls</strong>
                  <span className="text-muted">{(dashboard.totalToolCalls ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-row">
                <div className="card-info">
                  <strong>Task Runs</strong>
                  <span className="text-muted">{(dashboard.totalTaskRuns ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-row">
                <div className="card-info">
                  <strong>Unique Sessions</strong>
                  <span className="text-muted">{(dashboard.uniqueSessions ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-row">
                <div className="card-info">
                  <strong>Avg Response</strong>
                  <span className="text-muted">{(dashboard.avgResponseMs ?? 0).toLocaleString()}ms</span>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-row">
                <div className="card-info">
                  <strong>Task Success Rate</strong>
                  <span className="text-muted">{((dashboard.taskSuccessRate ?? 0) * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>

          {dashboard.topModels && dashboard.topModels.length > 0 && (
            <div className="section">
              <h2 className="section-header">Top Models</h2>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Requests</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.topModels.map((m) => (
                      <tr key={m.model}>
                        <td>{m.model}</td>
                        <td>{(m.count ?? 0).toLocaleString()}</td>
                        <td>${(m.costUsd ?? 0).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {dashboard.topTools && dashboard.topTools.length > 0 && (
            <div className="section">
              <h2 className="section-header">Top Tools</h2>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Calls</th>
                      <th>Avg Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.topTools.map((t) => (
                      <tr key={t.tool}>
                        <td>{t.tool}</td>
                        <td>{(t.count ?? 0).toLocaleString()}</td>
                        <td>{(t.avgDurationMs ?? 0).toLocaleString()}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {dashboard.recentErrors && dashboard.recentErrors.length > 0 && (
            <div className="section">
              <h2 className="section-header">Recent Errors</h2>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Project</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recentErrors.map((e) => (
                      <tr key={e.id}>
                        <td>{new Date(e.createdAt).toLocaleString()}</td>
                        <td className="text-muted">{e.projectId || '--'}</td>
                        <td className="text-muted">{e.errorMessage || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No dashboard data */}
      {activeTab === 'dashboard' && !dashboard && (
        <div className="section">
          <div className="empty-state">
            <p>No analytics data available</p>
          </div>
        </div>
      )}

      {/* Events Tab */}
      {activeTab === 'events' && (
        <div className="section">
          {events.length > 0 ? (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Project</th>
                    <th>Session</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>{new Date(event.createdAt).toLocaleString()}</td>
                      <td><span className="badge">{event.eventType}</span></td>
                      <td className="text-muted">{event.projectId || '--'}</td>
                      <td className="text-muted">{event.sessionId ? event.sessionId.slice(0, 8) : '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <p>No analytics events recorded</p>
            </div>
          )}
        </div>
      )}

      {/* Costs Tab */}
      {activeTab === 'costs' && (
        <div className="section">
          {costs.length > 0 ? (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Input Tokens</th>
                    <th>Output Tokens</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.map((cost) => (
                    <tr key={cost.projectId}>
                      <td>{cost.projectName || cost.projectId}</td>
                      <td>{(cost.inputTokens ?? 0).toLocaleString()}</td>
                      <td>{(cost.outputTokens ?? 0).toLocaleString()}</td>
                      <td>${(cost.totalCost ?? 0).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <p>No cost data available</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
