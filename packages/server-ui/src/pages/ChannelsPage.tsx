import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

/* ── Types ────────────────────────────────────────────────────── */

type ChannelType = 'slack' | 'discord' | 'telegram';

interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
}

/* ── Channel type metadata ────────────────────────────────────── */

const CHANNEL_TYPES: {
  type: ChannelType;
  label: string;
  description: string;
  configFields: Array<{ key: string; label: string; required: boolean; placeholder: string }>;
  credentialFields: Array<{ key: string; label: string; required: boolean; placeholder: string; secret?: boolean }>;
}[] = [
  {
    type: 'slack',
    label: 'Slack',
    description: 'Connect a Slack workspace via bot token',
    configFields: [
      { key: 'workspaceId', label: 'Workspace ID', required: true, placeholder: 'T0123456789' },
      { key: 'workspaceName', label: 'Workspace Name', required: true, placeholder: 'My Workspace' },
      { key: 'botUserId', label: 'Bot User ID', required: true, placeholder: 'U0123456789' },
    ],
    credentialFields: [
      { key: 'botToken', label: 'Bot Token', required: true, placeholder: 'xoxb-...', secret: true },
      { key: 'signingSecret', label: 'Signing Secret', required: true, placeholder: 'Slack signing secret', secret: true },
    ],
  },
  {
    type: 'discord',
    label: 'Discord',
    description: 'Connect a Discord bot application',
    configFields: [
      { key: 'applicationId', label: 'Application ID', required: true, placeholder: '123456789012345678' },
      { key: 'botUserId', label: 'Bot User ID', required: true, placeholder: '123456789012345678' },
      { key: 'guildId', label: 'Guild ID (optional)', required: false, placeholder: 'Restrict to a specific server' },
    ],
    credentialFields: [
      { key: 'botToken', label: 'Bot Token', required: true, placeholder: 'Discord bot token', secret: true },
      { key: 'publicKey', label: 'Public Key', required: true, placeholder: 'Ed25519 public key', secret: true },
    ],
  },
  {
    type: 'telegram',
    label: 'Telegram',
    description: 'Connect a Telegram bot via BotFather',
    configFields: [
      { key: 'botUsername', label: 'Bot Username', required: true, placeholder: 'my_bot' },
    ],
    credentialFields: [
      { key: 'botToken', label: 'Bot Token', required: true, placeholder: 'Bot token from BotFather', secret: true },
      { key: 'webhookSecret', label: 'Webhook Secret (optional)', required: false, placeholder: 'Optional secret for webhook verification', secret: true },
    ],
  },
];

/* ── Component ────────────────────────────────────────────────── */

export function ChannelsPage() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create channel state
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<ChannelType>('slack');
  const [createName, setCreateName] = useState('');
  const [createConfig, setCreateConfig] = useState<Record<string, string>>({});
  const [createCredentials, setCreateCredentials] = useState<Record<string, string>>({});
  const [createLoading, setCreateLoading] = useState(false);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  const loadChannels = useCallback(async () => {
    try {
      const data = await api.get<{ channels: Channel[] }>('/channels');
      setChannels(data.channels);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const resetCreateForm = () => {
    setCreateName('');
    setCreateConfig({});
    setCreateCredentials({});
    setCreateType('slack');
    setShowCreate(false);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);

    const typeInfo = CHANNEL_TYPES.find((t) => t.type === createType)!;

    // Build config — only include non-empty values
    const config: Record<string, string> = {};
    for (const field of typeInfo.configFields) {
      const val = createConfig[field.key]?.trim();
      if (val) config[field.key] = val;
      else if (field.required) {
        flashStatus('error', `${field.label} is required`);
        setCreateLoading(false);
        return;
      }
    }

    const credentials: Record<string, string> = {};
    for (const field of typeInfo.credentialFields) {
      const val = createCredentials[field.key]?.trim();
      if (val) credentials[field.key] = val;
      else if (field.required) {
        flashStatus('error', `${field.label} is required`);
        setCreateLoading(false);
        return;
      }
    }

    try {
      await api.post('/channels', {
        type: createType,
        name: createName.trim(),
        config,
        credentials,
        enabled: true,
      });
      flashStatus('success', 'Channel created');
      resetCreateForm();
      await loadChannels();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setCreateLoading(false);
    }
  };

  const selectedTypeInfo = CHANNEL_TYPES.find((t) => t.type === createType)!;

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1>Channels</h1>
          <p>Manage messaging platform integrations</p>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading channels...</span>
        </div>
      </>
    );
  }

  return (
    <div data-testid="server-ui-channels">
      <div className="page-header">
        <div className="flex justify-between items-center">
          <div>
            <h1>Channels</h1>
            <p>Manage messaging platform integrations</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)} data-testid="server-ui-channels-add">
            Add Channel
          </button>
        </div>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {channels.length > 0 ? (
        <div className="channel-list" data-testid="server-ui-channels-list">
          {channels.map((ch) => (
            <div
              key={ch.id}
              className="channel-list-item"
              data-testid={`server-ui-channel-item-${ch.id}`}
              onClick={() => navigate(`/channels/${ch.id}`)}
            >
              <div className="channel-list-item-info">
                <div className="channel-list-item-name">
                  <strong>{ch.name}</strong>
                  <span className={`badge badge-${ch.type === 'slack' ? 'primary' : ch.type === 'discord' ? 'primary' : 'primary'}`}>
                    {ch.type.charAt(0).toUpperCase() + ch.type.slice(1)}
                  </span>
                </div>
                <span className="text-muted text-sm">
                  {ch.enabled ? (
                    <span className="badge badge-success">Enabled</span>
                  ) : (
                    <span className="badge badge-warning">Disabled</span>
                  )}
                </span>
              </div>
              <span className="channel-list-item-arrow">&rsaquo;</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No channels configured</p>
          <p className="empty-hint">Add a Slack, Discord, or Telegram channel to get started</p>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => resetCreateForm()} data-testid="server-ui-channels-create-modal">
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h3>Add Channel</h3>
            <form onSubmit={handleCreate}>
              {/* Channel Type */}
              <div className="input-group">
                <label>Platform</label>
                <select
                  value={createType}
                  onChange={(e) => {
                    setCreateType(e.target.value as ChannelType);
                    setCreateConfig({});
                    setCreateCredentials({});
                  }}
                >
                  {CHANNEL_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>{t.label}</option>
                  ))}
                </select>
                <span className="text-muted text-sm mt-1" style={{ display: 'block' }}>
                  {selectedTypeInfo.description}
                </span>
              </div>

              {/* Channel Name */}
              <div className="input-group">
                <label>Name</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder={`My ${selectedTypeInfo.label} Channel`}
                  required
                  autoFocus
                />
              </div>

              {/* Config Fields */}
              <div className="form-section-label">Configuration</div>
              {selectedTypeInfo.configFields.map((field) => (
                <div className="input-group" key={field.key}>
                  <label>
                    {field.label}
                    {field.required && <span className="text-error"> *</span>}
                  </label>
                  <input
                    type="text"
                    value={createConfig[field.key] || ''}
                    onChange={(e) => setCreateConfig((v) => ({ ...v, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    required={field.required}
                  />
                </div>
              ))}

              {/* Credential Fields */}
              <div className="form-section-label">Credentials</div>
              {selectedTypeInfo.credentialFields.map((field) => (
                <div className="input-group" key={field.key}>
                  <label>
                    {field.label}
                    {field.required && <span className="text-error"> *</span>}
                  </label>
                  <input
                    type={field.secret ? 'password' : 'text'}
                    value={createCredentials[field.key] || ''}
                    onChange={(e) => setCreateCredentials((v) => ({ ...v, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    required={field.required}
                  />
                </div>
              ))}

              <div className="modal-actions">
                <button type="button" className="btn" onClick={resetCreateForm}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createLoading || !createName.trim()}
                >
                  {createLoading ? 'Creating...' : 'Create Channel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
