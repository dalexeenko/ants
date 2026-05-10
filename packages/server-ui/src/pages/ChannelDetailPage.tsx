import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

/* ── Types ────────────────────────────────────────────────────── */

type ChannelType = 'slack' | 'discord' | 'telegram';

interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
  credentials: { configured: boolean };
  createdAt: string;
  updatedAt: string;
}

interface Binding {
  id: string;
  channelId: string;
  projectId: string;
  triggerConfig: {
    events: string[];
    filters?: Array<{ type: string; include?: string[]; exclude?: string[] }>;
  };
  responseConfig?: {
    mode?: string;
    threadBehavior?: string;
    typingIndicator?: boolean;
    maxResponseLength?: number;
  };
  enabled: boolean;
  priority: number;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
}

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

/* ── Channel type field definitions ───────────────────────────── */

const CHANNEL_CONFIG_FIELDS: Record<ChannelType, Array<{ key: string; label: string; required: boolean; placeholder: string }>> = {
  slack: [
    { key: 'workspaceId', label: 'Workspace ID', required: true, placeholder: 'T0123456789' },
    { key: 'workspaceName', label: 'Workspace Name', required: true, placeholder: 'My Workspace' },
    { key: 'botUserId', label: 'Bot User ID', required: true, placeholder: 'U0123456789' },
  ],
  discord: [
    { key: 'applicationId', label: 'Application ID', required: true, placeholder: '123456789012345678' },
    { key: 'botUserId', label: 'Bot User ID', required: true, placeholder: '123456789012345678' },
    { key: 'guildId', label: 'Guild ID (optional)', required: false, placeholder: 'Restrict to a specific server' },
  ],
  telegram: [
    { key: 'botUsername', label: 'Bot Username', required: true, placeholder: 'my_bot' },
  ],
};

const CHANNEL_CREDENTIAL_FIELDS: Record<ChannelType, Array<{ key: string; label: string; required: boolean; placeholder: string }>> = {
  slack: [
    { key: 'botToken', label: 'Bot Token', required: true, placeholder: 'xoxb-...' },
    { key: 'signingSecret', label: 'Signing Secret', required: true, placeholder: 'Slack signing secret' },
  ],
  discord: [
    { key: 'botToken', label: 'Bot Token', required: true, placeholder: 'Discord bot token' },
    { key: 'publicKey', label: 'Public Key', required: true, placeholder: 'Ed25519 public key' },
  ],
  telegram: [
    { key: 'botToken', label: 'Bot Token', required: true, placeholder: 'Bot token from BotFather' },
    { key: 'webhookSecret', label: 'Webhook Secret (optional)', required: false, placeholder: 'Optional secret' },
  ],
};

const TRIGGER_EVENTS = [
  { value: 'mention', label: 'Mentions (@bot)' },
  { value: 'direct_message', label: 'Direct Messages' },
  { value: 'reaction', label: 'Reactions' },
  { value: 'keyword', label: 'Keywords' },
  { value: 'channel_message', label: 'All Channel Messages' },
];

const RESPONSE_MODES = [
  { value: 'reply', label: 'Reply' },
  { value: 'thread', label: 'Thread' },
  { value: 'dm', label: 'Direct Message' },
  { value: 'channel', label: 'Channel' },
];

const THREAD_BEHAVIORS = [
  { value: 'always', label: 'Always' },
  { value: 'if_exists', label: 'If Exists' },
  { value: 'never', label: 'Never' },
];

/* ── Component ────────────────────────────────────────────────── */

export function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Edit state
  const [editName, setEditName] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editConfig, setEditConfig] = useState<Record<string, string>>({});
  const [editCredentials, setEditCredentials] = useState<Record<string, string>>({});
  const [editDirty, setEditDirty] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Add binding state
  const [showAddBinding, setShowAddBinding] = useState(false);
  const [bindingProjectId, setBindingProjectId] = useState('');
  const [bindingEvents, setBindingEvents] = useState<string[]>(['mention', 'direct_message']);
  const [bindingResponseMode, setBindingResponseMode] = useState('thread');
  const [bindingThreadBehavior, setBindingThreadBehavior] = useState('always');
  const [bindingTypingIndicator, setBindingTypingIndicator] = useState(true);
  const [addBindingLoading, setAddBindingLoading] = useState(false);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const loadChannel = useCallback(async () => {
    if (!id) return;
    try {
      const [chanData, bindData, projData, statsData] = await Promise.allSettled([
        api.get<Channel>(`/channels/${id}`),
        api.get<{ bindings: Binding[] }>(`/channels/${id}/bindings`),
        api.get<{ projects: Project[] }>('/projects'),
        api.get<{ stats: QueueStats }>(`/channels/${id}/queue`),
      ]);

      if (chanData.status === 'fulfilled') {
        const ch = chanData.value;
        setChannel(ch);
        setEditName(ch.name);
        setEditEnabled(ch.enabled);
        // Populate config fields with current values
        const cfg: Record<string, string> = {};
        for (const [k, v] of Object.entries(ch.config)) {
          cfg[k] = String(v ?? '');
        }
        setEditConfig(cfg);
        setEditCredentials({});
        setEditDirty(false);
      }
      if (bindData.status === 'fulfilled') setBindings(bindData.value.bindings);
      if (projData.status === 'fulfilled') setProjects(projData.value.projects);
      if (statsData.status === 'fulfilled') setQueueStats(statsData.value.stats);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadChannel();
  }, [loadChannel]);

  /* ── Channel update ─────────────────────────────────────────── */

  const handleSaveChannel = async (e: FormEvent) => {
    e.preventDefault();
    if (!channel) return;
    setEditSaving(true);

    const updates: Record<string, unknown> = {};
    if (editName.trim() !== channel.name) updates.name = editName.trim();
    if (editEnabled !== channel.enabled) updates.enabled = editEnabled;

    // Config — only include non-empty changed values
    const configUpdates: Record<string, string> = {};
    let hasConfigChanges = false;
    for (const [k, v] of Object.entries(editConfig)) {
      if (v.trim() && v.trim() !== String(channel.config[k] ?? '')) {
        configUpdates[k] = v.trim();
        hasConfigChanges = true;
      } else if (v.trim()) {
        configUpdates[k] = v.trim();
      }
    }
    if (hasConfigChanges) updates.config = configUpdates;

    // Credentials — only include if user entered new values
    const credUpdates: Record<string, string> = {};
    let hasCredChanges = false;
    for (const [k, v] of Object.entries(editCredentials)) {
      if (v.trim()) {
        credUpdates[k] = v.trim();
        hasCredChanges = true;
      }
    }
    if (hasCredChanges) updates.credentials = credUpdates;

    if (Object.keys(updates).length === 0) {
      flashStatus('error', 'No changes to save');
      setEditSaving(false);
      return;
    }

    try {
      await api.patch(`/channels/${channel.id}`, updates);
      flashStatus('success', 'Channel updated');
      await loadChannel();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to update channel');
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!channel) return;
    try {
      await api.patch(`/channels/${channel.id}`, { enabled: !channel.enabled });
      flashStatus('success', channel.enabled ? 'Channel disabled' : 'Channel enabled');
      await loadChannel();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to toggle channel');
    }
  };

  const handleDeleteChannel = async () => {
    if (!channel || !confirm(`Delete channel "${channel.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/channels/${channel.id}`);
      flashStatus('success', 'Channel deleted');
      navigate('/channels');
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to delete channel');
    }
  };

  /* ── Binding management ─────────────────────────────────────── */

  const handleAddBinding = async (e: FormEvent) => {
    e.preventDefault();
    if (!channel || !bindingProjectId || bindingEvents.length === 0) return;
    setAddBindingLoading(true);

    try {
      await api.post(`/channels/${channel.id}/bindings`, {
        projectId: bindingProjectId,
        triggerConfig: {
          events: bindingEvents,
        },
        responseConfig: {
          mode: bindingResponseMode,
          threadBehavior: bindingThreadBehavior,
          typingIndicator: bindingTypingIndicator,
        },
        enabled: true,
      });
      flashStatus('success', 'Binding added');
      setShowAddBinding(false);
      setBindingProjectId('');
      setBindingEvents(['mention', 'direct_message']);
      setBindingResponseMode('thread');
      setBindingThreadBehavior('always');
      setBindingTypingIndicator(true);
      await loadChannel();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to add binding');
    } finally {
      setAddBindingLoading(false);
    }
  };

  const handleToggleBinding = async (binding: Binding) => {
    if (!channel) return;
    try {
      await api.patch(`/channels/${channel.id}/bindings/${binding.id}`, {
        enabled: !binding.enabled,
      });
      await loadChannel();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to toggle binding');
    }
  };

  const handleDeleteBinding = async (binding: Binding) => {
    if (!channel || !confirm('Delete this binding?')) return;
    try {
      await api.delete(`/channels/${channel.id}/bindings/${binding.id}`);
      flashStatus('success', 'Binding removed');
      await loadChannel();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to delete binding');
    }
  };

  const toggleEvent = (event: string) => {
    setBindingEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  /* ── Helpers ────────────────────────────────────────────────── */

  const getWebhookUrl = () => {
    if (!channel) return '';
    const base = window.location.origin;
    return `${base}/api/beta/webhooks/channels/${channel.type}/events`;
  };

  const getProjectName = (projectId: string) => {
    return projects.find((p) => p.id === projectId)?.name || projectId;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /* ── Render ─────────────────────────────────────────────────── */

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1>Channel</h1>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading channel...</span>
        </div>
      </>
    );
  }

  if (!channel) {
    return (
      <>
        <div className="page-header">
          <h1>Channel Not Found</h1>
          <p>The requested channel does not exist.</p>
        </div>
        <button className="btn" onClick={() => navigate('/channels')}>
          Back to Channels
        </button>
      </>
    );
  }

  const configFields = CHANNEL_CONFIG_FIELDS[channel.type] || [];
  const credentialFields = CHANNEL_CREDENTIAL_FIELDS[channel.type] || [];

  return (
    <div data-testid="server-ui-channel-detail">
      {/* Header */}
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-sm"
                onClick={() => navigate('/channels')}
                style={{ marginRight: 8 }}
              >
                &larr; Channels
              </button>
              <h1 style={{ marginBottom: 0 }}>{channel.name}</h1>
              <span className="badge badge-primary">
                {channel.type.charAt(0).toUpperCase() + channel.type.slice(1)}
              </span>
            </div>
            <p className="mt-1">
              {channel.enabled ? (
                <span className="badge badge-success">Enabled</span>
              ) : (
                <span className="badge badge-warning">Disabled</span>
              )}
              <span className="text-muted text-sm" style={{ marginLeft: 8 }}>
                Created {formatDate(channel.createdAt)}
              </span>
            </p>
          </div>
          <button
            className={`btn btn-sm ${channel.enabled ? '' : 'btn-primary'}`}
            onClick={handleToggleEnabled}
            data-testid="server-ui-channel-toggle"
          >
            {channel.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {/* Edit Channel Form */}
      <div className="section">
        <h2 className="section-header">Configuration</h2>
        <form onSubmit={handleSaveChannel}>
          <div className="card">
            <div className="input-group">
              <label>Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => { setEditName(e.target.value); setEditDirty(true); }}
              />
            </div>

            {configFields.map((field) => (
              <div className="input-group" key={field.key}>
                <label>
                  {field.label}
                  {field.required && <span className="text-error"> *</span>}
                </label>
                <input
                  type="text"
                  value={editConfig[field.key] || ''}
                  onChange={(e) => {
                    setEditConfig((v) => ({ ...v, [field.key]: e.target.value }));
                    setEditDirty(true);
                  }}
                  placeholder={field.placeholder}
                />
              </div>
            ))}

            <div className="form-section-label mt-3">Credentials</div>
            <p className="text-muted text-sm mb-2">
              Leave blank to keep existing credentials. Enter new values to update.
            </p>
            {credentialFields.map((field) => (
              <div className="input-group" key={field.key}>
                <label>{field.label}</label>
                <input
                  type="password"
                  value={editCredentials[field.key] || ''}
                  onChange={(e) => {
                    setEditCredentials((v) => ({ ...v, [field.key]: e.target.value }));
                    setEditDirty(true);
                  }}
                  placeholder={`Enter new ${field.label.toLowerCase()} to update`}
                />
              </div>
            ))}

            {editDirty && (
              <div className="flex gap-2 mt-3">
                <button type="submit" className="btn btn-primary btn-sm" disabled={editSaving} data-testid="server-ui-channel-save">
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => loadChannel()}
                >
                  Discard
                </button>
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Webhook URL */}
      <div className="section">
        <h2 className="section-header">Webhook URL</h2>
        <p className="section-description">
          Configure your {channel.type.charAt(0).toUpperCase() + channel.type.slice(1)} app to send events to this URL.
        </p>
        <div className="card">
          <code className="webhook-url">{getWebhookUrl()}</code>
        </div>
      </div>

      {/* Project Bindings */}
      <div className="section">
        <div className="section-header flex justify-between items-center">
          <div>
            <h2>Project Bindings</h2>
            <p className="section-description">
              Connect this channel to projects to route messages to agents.
            </p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setShowAddBinding(true)} data-testid="server-ui-channel-add-binding">
            Add Binding
          </button>
        </div>

        {bindings.length > 0 ? (
          <div className="card" style={{ padding: 0 }}>
            {bindings.map((binding, i) => (
              <div
                key={binding.id}
                className="binding-row"
                style={i < bindings.length - 1 ? { borderBottom: '1px solid var(--border-light)' } : undefined}
              >
                <div className="binding-row-main">
                  <div className="binding-row-info">
                    <strong>{getProjectName(binding.projectId)}</strong>
                    <div className="binding-badges">
                      {binding.enabled ? (
                        <span className="badge badge-success">Active</span>
                      ) : (
                        <span className="badge badge-warning">Inactive</span>
                      )}
                      {binding.triggerConfig.events.map((ev) => (
                        <span className="badge badge-default" key={ev}>
                          {TRIGGER_EVENTS.find((t) => t.value === ev)?.label || ev}
                        </span>
                      ))}
                      {binding.responseConfig?.mode && (
                        <span className="badge badge-primary">
                          {RESPONSE_MODES.find((m) => m.value === binding.responseConfig?.mode)?.label || binding.responseConfig.mode}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="card-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => handleToggleBinding(binding)}
                    >
                      {binding.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDeleteBinding(binding)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>No project bindings</p>
            <p className="empty-hint">Add a binding to route messages from this channel to a project</p>
          </div>
        )}
      </div>

      {/* Message Queue */}
      {queueStats && (
        <div className="section">
          <h2 className="section-header">Message Queue</h2>
          <div className="card">
            <div className="queue-stats">
              <div className="queue-stat">
                <span className="queue-stat-value">{queueStats.pending}</span>
                <span className="queue-stat-label">Pending</span>
              </div>
              <div className="queue-stat">
                <span className="queue-stat-value">{queueStats.processing}</span>
                <span className="queue-stat-label">Processing</span>
              </div>
              <div className="queue-stat">
                <span className="queue-stat-value">{queueStats.completed}</span>
                <span className="queue-stat-label">Completed</span>
              </div>
              <div className="queue-stat">
                <span className="queue-stat-value">{queueStats.failed}</span>
                <span className="queue-stat-label">Failed</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Danger Zone */}
      <div className="section">
        <div className="card" style={{ borderColor: 'var(--error)' }}>
          <h3 className="text-error">Danger Zone</h3>
          <p className="text-muted text-sm mt-1 mb-3">
            Deleting a channel removes all bindings and cannot be undone.
          </p>
          <button className="btn btn-danger btn-sm" onClick={handleDeleteChannel} data-testid="server-ui-channel-delete">
            Delete Channel
          </button>
        </div>
      </div>

      {/* Add Binding Modal */}
      {showAddBinding && (
        <div className="modal-overlay" onClick={() => setShowAddBinding(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h3>Add Project Binding</h3>
            <form onSubmit={handleAddBinding}>
              {/* Project Select */}
              <div className="input-group">
                <label>Project <span className="text-error">*</span></label>
                <select
                  value={bindingProjectId}
                  onChange={(e) => setBindingProjectId(e.target.value)}
                  required
                >
                  <option value="">Select a project...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Trigger Events */}
              <div className="input-group">
                <label>Trigger Events <span className="text-error">*</span></label>
                <div className="checkbox-group">
                  {TRIGGER_EVENTS.map((ev) => (
                    <label className="toggle-label" key={ev.value}>
                      <input
                        type="checkbox"
                        checked={bindingEvents.includes(ev.value)}
                        onChange={() => toggleEvent(ev.value)}
                      />
                      {ev.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Response Mode */}
              <div className="input-group">
                <label>Response Mode</label>
                <select
                  value={bindingResponseMode}
                  onChange={(e) => setBindingResponseMode(e.target.value)}
                >
                  {RESPONSE_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Thread Behavior */}
              <div className="input-group">
                <label>Thread Behavior</label>
                <select
                  value={bindingThreadBehavior}
                  onChange={(e) => setBindingThreadBehavior(e.target.value)}
                >
                  {THREAD_BEHAVIORS.map((b) => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </select>
              </div>

              {/* Typing Indicator */}
              <label className="toggle-label mt-2">
                <input
                  type="checkbox"
                  checked={bindingTypingIndicator}
                  onChange={(e) => setBindingTypingIndicator(e.target.checked)}
                />
                Show typing indicator
              </label>

              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowAddBinding(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={addBindingLoading || !bindingProjectId || bindingEvents.length === 0}
                >
                  {addBindingLoading ? 'Adding...' : 'Add Binding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
