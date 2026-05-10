import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/**
 * ConnectPage — handles the app authorization flow.
 *
 * The app opens /auth/connect in the system browser. If the user isn't
 * authenticated, /auth/connect redirects to /login?connect=true&...
 * which LoginPage handles. After login, the user is redirected back to
 * /auth/connect which generates a one-time code.
 *
 * This page is only shown if the flow arrives at /connect directly
 * (shouldn't normally happen, but handles the case gracefully).
 */
export function ConnectPage() {
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  const redirectUri = searchParams.get('redirect_uri');
  const state = searchParams.get('state');

  useEffect(() => {
    // If the user is already logged in and we have redirect params,
    // redirect back to /auth/connect which will generate the auth code
    if (!loading && user && redirectUri && !redirecting) {
      setRedirecting(true);
      const connectUrl = `/api/beta/auth/connect?redirect_uri=${encodeURIComponent(redirectUri)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
      window.location.href = connectUrl;
    }
  }, [user, loading, redirectUri, state, redirecting]);

  if (loading) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="loading">
            <div className="spinner" />
            <span>Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (redirecting) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1>Authorizing</h1>
          <p className="subtitle">Redirecting back to the app...</p>
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container" data-testid="server-ui-connect">
      <div className="login-card">
        <h1>Authorize App</h1>
        <p className="subtitle">
          An application is requesting access to your OpenMgr account.
        </p>

        {!redirectUri ? (
          <div className="status-banner error">
            Missing redirect URI. This page should be opened from the OpenMgr app.
          </div>
        ) : !user ? (
          <>
            <p className="text-muted mt-2">
              You need to sign in first before authorizing the app.
            </p>
            <a
              href={`/login?redirect_uri=${encodeURIComponent(redirectUri)}${state ? `&state=${encodeURIComponent(state)}` : ''}&connect=true`}
              className="btn btn-primary btn-block btn-lg mt-4"
            >
              Sign In
            </a>
          </>
        ) : (
          <div className="mt-2">
            <p>
              Signed in as <strong>{user.displayName || user.username}</strong>
            </p>
            <button
              data-testid="server-ui-connect-authorize"
              className="btn btn-primary btn-block btn-lg mt-4"
              onClick={() => {
                setRedirecting(true);
                const connectUrl = `/api/beta/auth/connect?redirect_uri=${encodeURIComponent(redirectUri)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
                window.location.href = connectUrl;
              }}
            >
              Authorize
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
