import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { api } from './api';

/* ── Types ─────────────────────────────────────────────────────────── */

export interface User {
  id: string;
  username: string;
  displayName?: string;
  email?: string | null;
  role?: string;
}

export interface OAuthProviderInfo {
  id: string;
  type: string;
}

interface AuthStatus {
  multiUser: boolean;
  needsSetup: boolean;
  authMethods: string[];
  currentUser: User | null;
  hasCfAccess: boolean;
  oauthProviders?: OAuthProviderInfo[];
  serverVersion?: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  multiUser: boolean;
  needsSetup: boolean;
  authMethods: string[];
  oauthProviders: OAuthProviderInfo[];
  serverVersion?: string;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

/* ── Context ───────────────────────────────────────────────────────── */

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

/* ── Provider ──────────────────────────────────────────────────────── */

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
    multiUser: false,
    needsSetup: false,
    authMethods: [],
    oauthProviders: [],
    serverVersion: undefined,
  });

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<AuthStatus>('/auth/status');
      if (data.needsSetup) {
        console.log('[auth] Server reports needsSetup=true, will redirect to /setup');
      }
      setState({
        user: data.currentUser,
        loading: false,
        error: null,
        multiUser: data.multiUser,
        needsSetup: data.needsSetup ?? false,
        authMethods: data.authMethods,
        oauthProviders: data.oauthProviders ?? [],
        serverVersion: data.serverVersion,
      });
    } catch (err) {
      // Auth endpoint may not exist yet or user isn't logged in
      console.warn('[auth] Failed to fetch /auth/status:', err);
      setState((s) => ({ ...s, user: null, loading: false, error: null }));
    }
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        await api.post('/auth/login', { username, password });
        await refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Login failed';
        setState((s) => ({ ...s, loading: false, error: message }));
        throw err;
      }
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore errors
    }
    setState((s) => ({ ...s, user: null, loading: false, error: null }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While loading the initial auth status, render nothing to prevent
  // child components from making authenticated API calls that would
  // trigger 401 redirects before we know if setup is needed.
  if (state.loading) {
    return (
      <AuthContext.Provider value={{ ...state, login, logout, refresh }}>
        {null}
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

/* ── Auth Layout ───────────────────────────────────────────────────── */

/**
 * Layout route that wraps all routes with AuthProvider and handles
 * redirects that require router context (e.g. setup redirect).
 * Must be rendered inside a RouterProvider.
 */
export function AuthLayout() {
  return (
    <AuthProvider>
      <AuthRedirectGuard />
    </AuthProvider>
  );
}

/**
 * Handles auth-related redirects. Rendered inside both AuthProvider
 * and the router, so it has access to both auth state and navigation.
 */
function AuthRedirectGuard() {
  const { loading, needsSetup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && needsSetup && location.pathname !== '/setup') {
      console.log(`[auth] Redirecting from ${location.pathname} to /setup (needsSetup=true)`);
      navigate('/setup', { replace: true });
    }
  }, [loading, needsSetup, location.pathname, navigate]);

  return <Outlet />;
}
