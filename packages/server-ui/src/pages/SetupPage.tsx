import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

interface SetupStatus {
  needsSetup: boolean;
  setupTokenRequired: boolean;
}

export function SetupPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);

  useEffect(() => {
    api
      .get<SetupStatus>('/setup/status')
      .then((data) => {
        setSetupStatus(data);
        if (!data.needsSetup) {
          // Setup already completed, go to login
          navigate('/login');
        }
      })
      .catch(() => {
        // Setup endpoint not available (single-user mode or older server)
        navigate('/login');
      })
      .finally(() => setCheckingStatus(false));
  }, [navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await api.post('/setup', {
        username,
        password,
        ...(setupStatus?.setupTokenRequired ? { setupToken } : {}),
      });

      // Refresh auth state — the setup endpoint sets a session cookie,
      // so the user is now logged in as admin
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  if (checkingStatus) {
    return (
      <div className="login-container">
        <div className="login-card">
          <p className="subtitle">Checking server status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>Server Setup</h1>
        <p className="subtitle">
          Create the initial administrator account to get started.
        </p>

        {error && <div className="status-banner error" data-testid="server-ui-setup-error">{error}</div>}

        <form onSubmit={handleSubmit} data-testid="server-ui-setup-form">
          {setupStatus?.setupTokenRequired && (
            <div className="input-group">
              <label htmlFor="setupToken">Setup Token</label>
              <input
                id="setupToken"
                data-testid="server-ui-setup-token"
                type="password"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                placeholder="OPENMGR_SETUP_TOKEN"
                autoComplete="off"
                required
              />
              <p className="text-secondary" style={{ fontSize: 12, marginTop: 4 }}>
                The token set via the OPENMGR_SETUP_TOKEN environment variable.
              </p>
            </div>
          )}

          <div className="input-group">
            <label htmlFor="username">Admin Username</label>
            <input
              id="username"
              data-testid="server-ui-setup-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              minLength={2}
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              data-testid="server-ui-setup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              data-testid="server-ui-setup-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg mt-4"
            data-testid="server-ui-setup-submit"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create Admin Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
