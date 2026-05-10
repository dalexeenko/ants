/**
 * Web app entry point.
 *
 * Bootstraps the web version of the Ants app:
 * 1. Checks authentication (cookie-based)
 * 2. Initializes the BridgeCore with a same-origin ServerClient
 * 3. Renders the shared AppShell from @ants/ui with a web PlatformAdapter
 */

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createWebBridge, initializeWebBridge } from './bridge';
import { type AgentBridge } from '@ants/ui';
import { PlatformProvider, type PlatformAdapter } from '@ants/ui/platform';
import { AppShell } from '@ants/ui/shell';

// Extend window type for the bridge
declare global {
  interface Window {
    agentBridge?: AgentBridge;
  }
}

// Suppress React Native Web's "Unexpected text node" warning
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Unexpected text node')) {
    return;
  }
  originalConsoleError.apply(console, args);
};

// Web platform adapter — no native capabilities
const webAdapter: PlatformAdapter = {
  platform: 'web',
  // No native filesystem dialogs — ProjectSetupModal will use the server's
  // filesystem API through the bridge when these are absent.
  // No native shortcuts — useShortcuts falls back to DOM keydown listeners.
  // No deeplinks, director IPC, or embedded browser views on web.
};

function WebApp() {
  const [state, setState] = useState<'loading' | 'unauthenticated' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        // Check auth status via cookie
        const authResponse = await fetch('/api/beta/auth/status', { credentials: 'include' });
        if (!authResponse.ok) {
          setState('unauthenticated');
          return;
        }

        const authData = await authResponse.json();
        if (!authData.authenticated) {
          setState('unauthenticated');
          return;
        }

        // Create and initialize the bridge
        const { bridge } = createWebBridge();
        window.agentBridge = bridge;

        await initializeWebBridge(bridge);
        setState('ready');
      } catch (e) {
        console.error('Failed to initialize web app:', e);
        setError(e instanceof Error ? e.message : String(e));
        setState('error');
      }
    }

    init();
  }, []);

  if (state === 'loading') {
    return (
      <div style={loadingStyles.center}>
        <div style={loadingStyles.spinner} />
        <p style={loadingStyles.text}>Loading...</p>
      </div>
    );
  }

  if (state === 'unauthenticated') {
    // Redirect to the server UI login page
    window.location.href = '/login?redirect=' + encodeURIComponent('/app/');
    return (
      <div style={loadingStyles.center}>
        <p style={loadingStyles.text}>Redirecting to login...</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={loadingStyles.center}>
        <p style={loadingStyles.errorText}>Failed to initialize</p>
        <p style={loadingStyles.text}>{error}</p>
        <button
          style={loadingStyles.button}
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  // Ready — render the full app shell
  return (
    <PlatformProvider adapter={webAdapter}>
      <AppShell />
    </PlatformProvider>
  );
}

// Loading/error styles (plain CSS — used before React Native Web is active)
const loadingStyles: Record<string, React.CSSProperties> = {
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    background: '#1a1a2e',
    color: '#e0e0e0',
  },
  text: {
    color: '#a0a0b0',
    fontSize: '14px',
    marginTop: '8px',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: '16px',
    fontWeight: 600,
  },
  button: {
    marginTop: '16px',
    padding: '8px 24px',
    background: '#4a4a6a',
    color: '#e0e0e0',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #333',
    borderTopColor: '#7c7cff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

// Add spinner animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(styleSheet);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <WebApp />
  </React.StrictMode>
);
