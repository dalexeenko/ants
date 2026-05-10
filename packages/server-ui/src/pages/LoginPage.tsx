import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  microsoft: 'Microsoft',
  oidc: 'SSO',
};

export function LoginPage() {
  const { login, oauthProviders, authMethods } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    searchParams.get('error'),
  );
  const [loading, setLoading] = useState(false);

  // If we arrived via /auth/connect, preserve the redirect params
  const isConnect = searchParams.get('connect') === 'true';
  const redirectUri = searchParams.get('redirect_uri');
  const state = searchParams.get('state');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);

      if (isConnect && redirectUri) {
        // After login, redirect back to /auth/connect which will now find the
        // session cookie and generate an auth code for the app.
        const connectUrl = `/api/beta/auth/connect?redirect_uri=${encodeURIComponent(redirectUri)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
        window.location.href = connectUrl;
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = (providerId: string) => {
    // Build the OAuth initiation URL, preserving app connect params
    let url = `/api/beta/auth/oauth/${providerId}`;
    const params = new URLSearchParams();
    if (isConnect && redirectUri) {
      params.set('redirect_uri', redirectUri);
      if (state) params.set('state', state);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
    window.location.href = url;
  };

  const hasPassword = authMethods.includes('password');
  const hasOAuth = oauthProviders.length > 0;

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>Sign In</h1>
        <p className="subtitle">
          {isConnect
            ? 'Sign in to authorize the OpenMgr app'
            : 'Sign in to your OpenMgr server'}
        </p>

        {error && (
          <div className="status-banner error" data-testid="server-ui-login-error">{error}</div>
        )}

        {hasPassword && (
          <form onSubmit={handleSubmit} data-testid="server-ui-login-form">
            <div className="input-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username"
                required
                data-testid="server-ui-login-username"
              />
            </div>
            <div className="input-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                required
                data-testid="server-ui-login-password"
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-block btn-lg mt-4"
              disabled={loading}
              data-testid="server-ui-login-submit"
            >
              {loading ? 'Signing in...' : isConnect ? 'Sign In & Authorize' : 'Sign In'}
            </button>
          </form>
        )}

        {hasPassword && hasOAuth && (
          <div className="divider-or">
            <div className="line" />
            <span>Or continue with</span>
            <div className="line" />
          </div>
        )}

        {hasOAuth && (
          <div className="social-buttons">
            {oauthProviders.map((provider) => (
              <button
                key={provider.id}
                className="btn btn-block"
                onClick={() => handleOAuthLogin(provider.id)}
                data-testid={`server-ui-login-oauth-${provider.id}`}
              >
                Sign in with {PROVIDER_LABELS[provider.type] || provider.type}
              </button>
            ))}
          </div>
        )}

        {!hasPassword && !hasOAuth && (
          <p className="text-secondary">No authentication methods configured.</p>
        )}
      </div>
    </div>
  );
}
