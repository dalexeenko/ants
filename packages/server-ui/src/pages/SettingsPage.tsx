import { useState, useEffect, useCallback, type FormEvent, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const DEEPLINK_SCHEME = 'openmgr';

/* ── Types ────────────────────────────────────────────────────── */

interface ProviderInfo {
  id: string;
  name: string;
  isConfigured: boolean;
  hasApiKey: boolean;
  fields: Array<{ envVar: string; label: string; required: boolean }>;
  oauth?: { hasRefreshToken: boolean; expiresAt?: number };
}

interface PluginInfo {
  id: string;
  packageName: string;
  packageSpec: string;
  version: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SystemInfo {
  uptimeSeconds: number;
  uptimeHuman: string;
  memoryUsage: { rss: number; heapTotal: number; heapUsed: number };
  nodeVersion: string;
  platform: string;
  arch: string;
}

interface DiskInfo {
  dataDir: { path: string; sizeHuman: string };
  workspacesDir?: { path: string; sizeHuman: string };
  total: { sizeHuman: string };
}


/* ── Component ────────────────────────────────────────────────── */

export function SettingsPage() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Edit states
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editLoading, setEditLoading] = useState(false);

  // Plugin install
  const [showInstall, setShowInstall] = useState(false);
  const [installSpec, setInstallSpec] = useState('');
  const [installLoading, setInstallLoading] = useState(false);

  // Connect App
  const [connectLoading, setConnectLoading] = useState(false);

  // OAuth
  const [oauthStep, setOauthStep] = useState<'idle' | 'intro' | 'code'>('idle');
  const [oauthSessionId, setOauthSessionId] = useState('');
  const [oauthCode, setOauthCode] = useState('');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthUrl, setOauthUrl] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const [provData, sysData, diskData, plugData] = await Promise.allSettled([
        api.get<{ providers: ProviderInfo[] }>('/system/api-keys'),
        api.get<SystemInfo>('/system/uptime'),
        api.get<DiskInfo>('/system/disk'),
        api.get<{ plugins: PluginInfo[] }>('/system/plugins'),
      ]);

      if (provData.status === 'fulfilled') setProviders(provData.value.providers);
      if (sysData.status === 'fulfilled') setSystemInfo(sysData.value);
      if (diskData.status === 'fulfilled') setDiskInfo(diskData.value);
      if (plugData.status === 'fulfilled') setPlugins(plugData.value.plugins);
    } catch {
      // individual errors handled above
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const flashStatus = (type: 'success' | 'error', message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus(null), 5000);
  };

  /* ── Provider Key Management ────────────────────────────────── */

  const openEditProvider = async (providerId: string) => {
    try {
      // The provider detail endpoint returns { keys, oauth? } not { provider }.
      // We already have the provider's field list from the initial load, so use that.
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        flashStatus('error', 'Provider not found');
        return;
      }
      const vals: Record<string, string> = {};
      for (const f of provider.fields) {
        vals[f.envVar] = ''; // Don't pre-fill with actual keys
      }
      setEditValues(vals);
      setEditProvider(providerId);
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to load provider details');
    }
  };

  const saveProviderKeys = async (e: FormEvent) => {
    e.preventDefault();
    if (!editProvider) return;
    setEditLoading(true);
    try {
      // Filter out empty values (don't overwrite existing keys with empty)
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(editValues)) {
        if (v.trim()) values[k] = v.trim();
      }
      if (Object.keys(values).length === 0) {
        flashStatus('error', 'Please enter at least one API key');
        return;
      }
      await api.put(`/system/api-keys/${editProvider}`, { values });
      flashStatus('success', 'API keys saved');
      setEditProvider(null);
      await loadAll();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to save keys');
    } finally {
      setEditLoading(false);
    }
  };

  const deleteProviderKeys = async (providerId: string) => {
    if (!confirm('Remove all API keys for this provider?')) return;
    try {
      await api.delete(`/system/api-keys/${providerId}`);
      flashStatus('success', 'API keys removed');
      await loadAll();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to remove keys');
    }
  };

  /* ── Anthropic OAuth ────────────────────────────────────────── */

  const startAnthropicOAuth = async () => {
    setOauthLoading(true);
    try {
      const result = await api.get<{ url: string; sessionId: string }>(
        '/system/api-keys/anthropic/oauth/url',
      );
      setOauthSessionId(result.sessionId);
      setOauthUrl(result.url);
      window.open(result.url, '_blank');
      setOauthStep('code');
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to start OAuth');
    } finally {
      setOauthLoading(false);
    }
  };

  const submitOAuthCode = async (e: FormEvent) => {
    e.preventDefault();
    setOauthLoading(true);
    try {
      await api.post('/system/api-keys/anthropic/oauth/code', {
        code: oauthCode.trim(),
        sessionId: oauthSessionId,
      });
      flashStatus('success', 'Anthropic OAuth connected');
      setOauthStep('idle');
      setOauthCode('');
      await loadAll();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to exchange code');
    } finally {
      setOauthLoading(false);
    }
  };

  const disconnectAnthropicOAuth = async () => {
    if (!confirm('Disconnect Anthropic OAuth?')) return;
    try {
      await api.delete('/system/api-keys/anthropic/oauth');
      flashStatus('success', 'Anthropic OAuth disconnected');
      await loadAll();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  /* ── Plugin Management ──────────────────────────────────────── */

  const installPlugin = async (e: FormEvent) => {
    e.preventDefault();
    if (!installSpec.trim()) return;
    setInstallLoading(true);
    try {
      const spec = installSpec.trim();
      await api.post('/system/plugins', { packageName: spec, packageSpec: spec });
      flashStatus('success', `Plugin installed: ${spec}`);
      setShowInstall(false);
      setInstallSpec('');
      await loadAll();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to install plugin');
    } finally {
      setInstallLoading(false);
    }
  };

  const uninstallPlugin = async (pluginId: string, packageName: string) => {
    if (!confirm(`Uninstall ${packageName}?`)) return;
    try {
      await api.delete(`/system/plugins/${pluginId}`);
      flashStatus('success', `Plugin uninstalled: ${packageName}`);
      await loadAll();
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to uninstall plugin');
    }
  };

  /* ── Connect App ─────────────────────────────────────────────── */

  const connectApp = async (e: MouseEvent) => {
    e.preventDefault();
    setConnectLoading(true);
    try {
      const data = await api.post<{ code: string; serverUrl: string; serverName: string }>(
        '/auth/connect-token',
        { secure: window.location.protocol === 'https:' },
      );
      const params = new URLSearchParams({
        url: data.serverUrl,
        code: data.code,
        name: data.serverName,
      });
      const deeplink = `${DEEPLINK_SCHEME}://connect?${params.toString()}`;
      window.location.href = deeplink;
    } catch (err) {
      flashStatus('error', err instanceof Error ? err.message : 'Failed to generate connect link');
    } finally {
      setConnectLoading(false);
    }
  };

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1>Settings</h1>
          <p>Manage server configuration, API keys, plugins, and integrations</p>
        </div>
        <div className="loading">
          <div className="spinner" />
          <span>Loading settings...</span>
        </div>
      </>
    );
  }

  const anthropicProvider = providers.find((p) => p.id === 'anthropic');
  const allProviders = providers;

  return (
    <div data-testid="server-ui-settings">
      <div className="page-header">
        <h1>Settings</h1>
        <p>Manage server configuration, API keys, plugins, and integrations</p>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {/* Connect App Section */}
      <div className="section" data-testid="server-ui-settings-connect">
        <h2 className="section-header">Connect App</h2>
        <p className="section-description">
          Open this server in the OpenMgr desktop or mobile app.
        </p>
        <div className="card">
          <div className="card-row">
            <div className="card-info">
              <strong>Open in App</strong>
              <span className="text-muted">
                Connects the app to this server with your current account.
              </span>
            </div>
            <div className="card-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={connectApp}
                disabled={connectLoading}
              >
                {connectLoading ? 'Connecting...' : 'Open in App'}
              </button>
            </div>
          </div>
          <div className="card-row">
            <div className="card-info">
              <span className="text-muted text-sm">
                Don't have the app?{' '}
                <a href="https://apps.apple.com/app/openmgr" target="_blank" rel="noopener noreferrer">
                  iOS
                </a>
                {' / '}
                <a href="https://play.google.com/store/apps/details?id=com.openmgr" target="_blank" rel="noopener noreferrer">
                  Android
                </a>
                {' / '}
                <a href="https://openmgr.dev/download" target="_blank" rel="noopener noreferrer">
                  Desktop
                </a>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Anthropic OAuth Section */}
      {anthropicProvider && (
        <div className="section">
          <h2 className="section-header">Anthropic OAuth</h2>
          <p className="section-description">
            Connect your Anthropic account (requires Claude Pro/Max subscription).
          </p>
          <div className="card">
            <div className="card-row">
              <div className="card-info">
                <strong>Anthropic</strong>
                <span className="text-muted">
                  {anthropicProvider.oauth?.hasRefreshToken
                    ? 'Connected via OAuth'
                    : 'Not connected'}
                </span>
              </div>
              <div className="card-actions">
                {anthropicProvider.oauth?.hasRefreshToken ? (
                  <button className="btn btn-danger btn-sm" onClick={disconnectAnthropicOAuth}>
                    Disconnect
                  </button>
                ) : oauthStep === 'idle' ? (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setOauthStep('intro')}
                  >
                    Sign In with Anthropic
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* OAuth Intro Modal */}
          {oauthStep === 'intro' && (
            <div className="modal-overlay" onClick={() => setOauthStep('idle')}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>Sign In with Anthropic</h3>
                <p>
                  This will open Anthropic's website where you can authorize OpenMgr to use
                  your Claude Pro/Max subscription. You'll need to copy back an authorization code.
                </p>
                <div className="modal-actions">
                  <button className="btn" onClick={() => setOauthStep('idle')}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={startAnthropicOAuth}
                    disabled={oauthLoading}
                  >
                    {oauthLoading ? 'Opening...' : 'Continue'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* OAuth Code Entry Modal */}
          {oauthStep === 'code' && (
            <div className="modal-overlay">
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>Enter Authorization Code</h3>
                <p>
                  Paste the authorization code from Anthropic's website below.
                </p>
                {oauthUrl && (
                  <p>
                    <a href={oauthUrl} target="_blank" rel="noopener noreferrer">
                      Didn't open? Click here to authorize.
                    </a>
                  </p>
                )}
                <form onSubmit={submitOAuthCode}>
                  <div className="input-group">
                    <input
                      type="text"
                      value={oauthCode}
                      onChange={(e) => setOauthCode(e.target.value)}
                      placeholder="Paste authorization code here"
                      autoFocus
                    />
                  </div>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setOauthStep('idle');
                        setOauthCode('');
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={oauthLoading || !oauthCode.trim()}
                    >
                      {oauthLoading ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* API Keys Section */}
      <div className="section" data-testid="server-ui-settings-providers">
        <h2 className="section-header">API Keys</h2>
        <p className="section-description">
          Configure API keys for AI providers. These are stored encrypted on the server.
        </p>
        <div className="card">
          {allProviders.map((p) => (
            <div className="card-row" key={p.id}>
              <div className="card-info">
                <strong>{p.name}</strong>
                <span className="text-muted">
                  {p.hasApiKey ? (
                    <span className="badge badge-success">Configured</span>
                  ) : (
                    <span className="badge badge-default">Not configured</span>
                  )}
                </span>
              </div>
              <div className="card-actions">
                <button className="btn btn-sm" onClick={() => openEditProvider(p.id)}>
                  {p.hasApiKey ? 'Edit' : 'Add Key'}
                </button>
                {p.hasApiKey && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => deleteProviderKeys(p.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Edit Provider Modal */}
        {editProvider && (
          <div className="modal-overlay" onClick={() => setEditProvider(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>
                {providers.find((p) => p.id === editProvider)?.name ?? editProvider} API Keys
              </h3>
              <form onSubmit={saveProviderKeys}>
                {Object.keys(editValues).map((envVar) => (
                  <div className="input-group" key={envVar}>
                    <label>{envVar}</label>
                    <input
                      type="password"
                      value={editValues[envVar]}
                      onChange={(e) =>
                        setEditValues((v) => ({ ...v, [envVar]: e.target.value }))
                      }
                      placeholder="Enter API key"
                    />
                  </div>
                ))}
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={() => setEditProvider(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={editLoading}>
                    {editLoading ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Plugins Section */}
      <div className="section" data-testid="server-ui-settings-plugins">
        <div className="section-header flex justify-between items-center">
          <h2>Plugins</h2>
          <button className="btn btn-sm btn-primary" data-testid="server-ui-settings-install-plugin" onClick={() => setShowInstall(true)}>
            Install Plugin
          </button>
        </div>
        <p className="section-description">
          Extend the agent with additional tools and capabilities.
        </p>

        {plugins.length > 0 ? (
          <div className="card">
            {plugins.map((p) => (
              <div className="card-row" key={p.packageName}>
                <div className="card-info">
                  <strong>{p.packageName}</strong>
                  <span className="text-muted">
                    {p.version ? `v${p.version}` : p.packageSpec}
                  </span>
                </div>
                <div className="card-actions">
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => uninstallPlugin(p.id, p.packageName)}
                  >
                    Uninstall
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>No plugins installed</p>
            <p className="empty-hint">Install npm packages to add tools and capabilities</p>
          </div>
        )}

        {/* Install Plugin Modal */}
        {showInstall && (
          <div className="modal-overlay" onClick={() => setShowInstall(false)}>
            <div className="modal" data-testid="server-ui-settings-plugin-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Install Plugin</h3>
              <form onSubmit={installPlugin}>
                <div className="input-group">
                  <label>npm Package</label>
                  <input
                    type="text"
                    value={installSpec}
                    onChange={(e) => setInstallSpec(e.target.value)}
                    placeholder="e.g. @openmgr/plugin-example"
                    autoFocus
                  />
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={() => setShowInstall(false)}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={installLoading || !installSpec.trim()}
                  >
                    {installLoading ? 'Installing...' : 'Install'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Channels Section — links to dedicated page */}
      <div className="section">
        <div className="section-header flex justify-between items-center">
          <h2>Channels</h2>
          <button className="btn btn-sm" data-testid="server-ui-settings-manage-channels" onClick={() => navigate('/channels')}>
            Manage Channels
          </button>
        </div>
        <p className="section-description">
          Messaging platform integrations (Slack, Discord, Telegram).
        </p>
      </div>

      {/* System Information */}
      <div className="section" data-testid="server-ui-settings-system">
        <h2 className="section-header">System</h2>
        {systemInfo && (
          <div className="card">
            <div className="card-row">
              <div className="card-info">
                <strong>Uptime</strong>
                <span className="text-muted">{systemInfo.uptimeHuman}</span>
              </div>
            </div>
            <div className="card-row">
              <div className="card-info">
                <strong>Platform</strong>
                <span className="text-muted">
                  {systemInfo.platform} ({systemInfo.arch}) - Node {systemInfo.nodeVersion}
                </span>
              </div>
            </div>
            <div className="card-row">
              <div className="card-info">
                <strong>Memory</strong>
                <span className="text-muted">
                  {formatBytes(systemInfo.memoryUsage.heapUsed)} / {formatBytes(systemInfo.memoryUsage.heapTotal)} heap
                </span>
              </div>
            </div>
            {diskInfo && (
              <div className="card-row">
                <div className="card-info">
                  <strong>Disk</strong>
                  <span className="text-muted">{diskInfo.total.sizeHuman} total</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
