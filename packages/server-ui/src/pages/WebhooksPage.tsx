import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useProjects } from '../lib/useProjects';

/* ── Types ────────────────────────────────────────────────────── */

type WebhookSource = 'github' | 'gitlab' | 'bitbucket' | 'ci' | 'generic';

interface WebhookEndpoint {
  id: string;
  name: string;
  slug: string;
  source: WebhookSource;
  secret?: string;
  eventFilter?: string;
  promptTemplate: string;
  sessionMode?: string;
  enabled: boolean;
  deliveryCount: number;
  lastTriggeredAt?: string;
}

interface Delivery {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'ignored';
  event: string;
  createdAt: string;
}

/* ── Component ────────────────────────────────────────────────── */

export function WebhooksPage() {
  const { projects, selectedProjectId, setSelectedProjectId, loading: projectsLoading } = useProjects();
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});

  // Create webhook state
  const [showCreate, setShowCreate] = useState(false);
  const [webhookName, setWebhookName] = useState('');
  const [webhookSlug, setWebhookSlug] = useState('');
  const [webhookSource, setWebhookSource] = useState<WebhookSource>('generic');
  const [webhookPrompt, setWebhookPrompt] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const loadWebhooks = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const data = await api.get<{ endpoints: WebhookEndpoint[] }>(`/${selectedProjectId}/webhooks`);
      setWebhooks(data.endpoints);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  const loadDeliveries = async (webhookId: string) => {
    if (!selectedProjectId) return;
    try {
      const data = await api.get<{ deliveries: Delivery[] }>(
        `/${selectedProjectId}/webhooks/${webhookId}/deliveries?limit=20`,
      );
      setDeliveries((prev) => ({ ...prev, [webhookId]: data.deliveries }));
    } catch {
      // ignore
    }
  };

  const handleExpand = (webhookId: string) => {
    if (expandedWebhook === webhookId) {
      setExpandedWebhook(null);
    } else {
      setExpandedWebhook(webhookId);
      if (!deliveries[webhookId]) {
        loadDeliveries(webhookId);
      }
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setCreateLoading(true);
    try {
      await api.post(`/${selectedProjectId}/webhooks`, {
        name: webhookName.trim(),
        slug: webhookSlug.trim(),
        source: webhookSource,
        promptTemplate: webhookPrompt.trim(),
        enabled: true,
      });
      flashStatus('success', 'Webhook created');
      setShowCreate(false);
      setWebhookName('');
      setWebhookSlug('');
      setWebhookSource('generic');
      setWebhookPrompt('');
      await loadWebhooks();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!selectedProjectId) return;
    try {
      await api.delete(`/${selectedProjectId}/webhooks/${id}`);
      flashStatus('success', 'Webhook deleted');
      await loadWebhooks();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to delete webhook');
    }
  };

  const handleToggle = async (webhook: WebhookEndpoint) => {
    if (!selectedProjectId) return;
    try {
      await api.patch(`/${selectedProjectId}/webhooks/${webhook.id}`, { enabled: !webhook.enabled });
      await loadWebhooks();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to update webhook');
    }
  };

  if (projectsLoading) {
    return (
      <>
        <div className="page-header">
          <h1>Webhooks</h1>
          <p>Manage webhook endpoints and file watchers</p>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading...</span>
        </div>
      </>
    );
  }

  return (
    <div data-testid="server-ui-webhooks">
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h1>Webhooks</h1>
            <p>Manage webhook endpoints and file watchers</p>
          </div>
          {selectedProjectId && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)} data-testid="server-ui-webhooks-add">
              Add Webhook
            </button>
          )}
        </div>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {/* Project Selector */}
      {projects.length > 0 ? (
        <div className="section">
          <div className="input-group" style={{ maxWidth: '400px' }}>
            <label>Project</label>
            <select
              value={selectedProjectId || ''}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <p>No projects found</p>
          <p className="empty-hint">Create a project first to configure webhooks.</p>
        </div>
      )}

      {/* Webhook List */}
      {selectedProjectId && (
        <div className="section">
          {loading ? (
            <div className="loading">
              <div className="spinner" />
              <span>Loading webhooks...</span>
            </div>
          ) : webhooks.length > 0 ? (
            <div className="card">
              {webhooks.map((wh) => (
                <div key={wh.id}>
                  <div className="card-row">
                    <div className="card-info" style={{ cursor: 'pointer' }} onClick={() => handleExpand(wh.id)}>
                      <strong>{wh.name}</strong>
                      <span className="text-muted text-sm">
                        <span className="badge">{wh.source}</span>
                        {' · '}<code>/hooks/{selectedProjectId}/{wh.slug}</code>
                        {' · '}{wh.deliveryCount} deliveries
                        {wh.lastTriggeredAt && ` · Last: ${new Date(wh.lastTriggeredAt).toLocaleDateString()}`}
                      </span>
                    </div>
                    <div className="card-actions">
                      <label className="toggle-label">
                        <input
                          type="checkbox"
                          checked={wh.enabled}
                          onChange={() => handleToggle(wh)}
                          data-testid={`server-ui-webhook-toggle-${wh.id}`}
                        />
                      </label>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(wh.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Expanded: show deliveries */}
                  {expandedWebhook === wh.id && (
                    <div style={{ padding: '0 1rem 1rem', borderBottom: '1px solid var(--border-light)' }}>
                      <p className="text-sm" style={{ margin: '0 0 0.5rem' }}>
                        <strong>Prompt Template:</strong> {wh.promptTemplate}
                      </p>
                      {deliveries[wh.id] && deliveries[wh.id].length > 0 ? (
                        <div className="table-container">
                          <table>
                            <thead>
                              <tr>
                                <th>Event</th>
                                <th>Status</th>
                                <th>Time</th>
                              </tr>
                            </thead>
                            <tbody>
                              {deliveries[wh.id].map((d) => (
                                <tr key={d.id}>
                                  <td>{d.event}</td>
                                  <td>
                                    <span className={`badge badge-${d.status === 'completed' ? 'success' : d.status === 'failed' ? 'error' : 'warning'}`}>
                                      {d.status}
                                    </span>
                                  </td>
                                  <td className="text-muted">{new Date(d.createdAt).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-muted text-sm">No deliveries yet</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>No webhook endpoints configured</p>
              <p className="empty-hint">Create a webhook to trigger agent actions from external events.</p>
            </div>
          )}
        </div>
      )}

      {/* Create Webhook Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" data-testid="server-ui-webhooks-create-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Webhook Endpoint</h3>
            <form onSubmit={handleCreate}>
              <div className="input-group">
                <label>Name <span className="text-error">*</span></label>
                <input
                  type="text"
                  value={webhookName}
                  onChange={(e) => setWebhookName(e.target.value)}
                  placeholder="e.g., GitHub Push Events"
                  required
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label>Slug <span className="text-error">*</span></label>
                <input
                  type="text"
                  value={webhookSlug}
                  onChange={(e) => setWebhookSlug(e.target.value)}
                  placeholder="e.g., github-push"
                  required
                  pattern="^[a-z0-9][a-z0-9_-]*$"
                />
                <span className="text-muted text-sm" style={{ display: 'block', marginTop: '0.25rem' }}>
                  URL-safe identifier. Webhook URL will be: /hooks/{selectedProjectId}/{webhookSlug || '<slug>'}
                </span>
              </div>
              <div className="input-group">
                <label>Source</label>
                <select
                  value={webhookSource}
                  onChange={(e) => setWebhookSource(e.target.value as WebhookSource)}
                >
                  <option value="generic">Generic</option>
                  <option value="github">GitHub</option>
                  <option value="gitlab">GitLab</option>
                  <option value="bitbucket">Bitbucket</option>
                  <option value="ci">CI/CD</option>
                </select>
              </div>
              <div className="input-group">
                <label>Prompt Template <span className="text-error">*</span></label>
                <textarea
                  value={webhookPrompt}
                  onChange={(e) => setWebhookPrompt(e.target.value)}
                  placeholder="The prompt sent to the agent when this webhook fires. Use {{payload}} for the webhook payload."
                  required
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createLoading || !webhookName.trim() || !webhookSlug.trim() || !webhookPrompt.trim()}
                >
                  {createLoading ? 'Creating...' : 'Create Webhook'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
