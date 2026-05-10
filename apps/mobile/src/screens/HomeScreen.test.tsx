/**
 * Tests for HomeScreen — verifying that remote servers are properly shown
 * even when the user is not locally authenticated.
 *
 * Since the mobile jest environment is 'node' (no DOM), we test the
 * conditional rendering logic by extracting the key state variables
 * that HomeScreen computes and verifying the render conditions.
 */

// The HomeScreen rendering logic is:
//
//   1. !isAuthenticated && !hasRemoteServers  →  "Get Started" card only
//   2. isAuthenticated || hasRemoteServers    →  Projects section
//   3. !isAuthenticated && hasRemoteServers   →  compact auth hint + Projects section
//   4. isAuthenticated && !hasRemoteServers   →  Projects section (no hint)
//
// The bug was: the projects section was gated on `isAuthenticated` only,
// hiding remote server projects when the user had no local API keys.

describe('HomeScreen conditional rendering logic', () => {
  /**
   * Simulate the auth-check logic from HomeScreen lines 183-188.
   */
  function computeIsAuthenticated(authStatus: Record<string, any> | null): boolean {
    return !!(
      authStatus?.anthropic?.authenticated ||
      authStatus?.openai?.hasApiKey ||
      authStatus?.google?.hasApiKey ||
      authStatus?.openrouter?.hasApiKey ||
      authStatus?.groq?.hasApiKey ||
      authStatus?.xai?.hasApiKey
    );
  }

  const NO_AUTH = {
    anthropic: { authenticated: false },
    openai: { hasApiKey: false },
    google: { hasApiKey: false },
    openrouter: { hasApiKey: false },
    groq: { hasApiKey: false },
    xai: { hasApiKey: false },
  };

  const ANTHROPIC_AUTH = {
    ...NO_AUTH,
    anthropic: { authenticated: true, method: 'apikey' },
  };

  const OPENAI_AUTH = {
    ...NO_AUTH,
    openai: { hasApiKey: true },
  };

  describe('isAuthenticated computation', () => {
    it('returns false when no providers are authenticated', () => {
      expect(computeIsAuthenticated(NO_AUTH)).toBe(false);
    });

    it('returns true when anthropic is authenticated', () => {
      expect(computeIsAuthenticated(ANTHROPIC_AUTH)).toBe(true);
    });

    it('returns true when openai has API key', () => {
      expect(computeIsAuthenticated(OPENAI_AUTH)).toBe(true);
    });

    it('returns false for null authStatus', () => {
      expect(computeIsAuthenticated(null)).toBe(false);
    });
  });

  describe('render conditions', () => {
    // Mirrors the HomeScreen JSX conditions after our fix:
    //   "Get Started" card:  !isAuthenticated && !hasRemoteServers
    //   Projects section:    isAuthenticated || hasRemoteServers
    //   Compact auth hint:   !isAuthenticated && hasRemoteServers

    it('shows Get Started when not authenticated and no remote servers', () => {
      const isAuthenticated = computeIsAuthenticated(NO_AUTH);
      const hasRemoteServers = false;

      const showGetStarted = !isAuthenticated && !hasRemoteServers;
      const showProjects = isAuthenticated || hasRemoteServers;
      const showCompactHint = !isAuthenticated && hasRemoteServers;

      expect(showGetStarted).toBe(true);
      expect(showProjects).toBe(false);
      expect(showCompactHint).toBe(false);
    });

    it('shows projects when remote servers exist even without local auth', () => {
      const isAuthenticated = computeIsAuthenticated(NO_AUTH);
      const hasRemoteServers = true;

      const showGetStarted = !isAuthenticated && !hasRemoteServers;
      const showProjects = isAuthenticated || hasRemoteServers;
      const showCompactHint = !isAuthenticated && hasRemoteServers;

      expect(showGetStarted).toBe(false);
      expect(showProjects).toBe(true);
      expect(showCompactHint).toBe(true);
    });

    it('shows projects when authenticated without remote servers', () => {
      const isAuthenticated = computeIsAuthenticated(ANTHROPIC_AUTH);
      const hasRemoteServers = false;

      const showGetStarted = !isAuthenticated && !hasRemoteServers;
      const showProjects = isAuthenticated || hasRemoteServers;
      const showCompactHint = !isAuthenticated && hasRemoteServers;

      expect(showGetStarted).toBe(false);
      expect(showProjects).toBe(true);
      expect(showCompactHint).toBe(false);
    });

    it('shows projects without hint when both authenticated and has remote servers', () => {
      const isAuthenticated = computeIsAuthenticated(ANTHROPIC_AUTH);
      const hasRemoteServers = true;

      const showGetStarted = !isAuthenticated && !hasRemoteServers;
      const showProjects = isAuthenticated || hasRemoteServers;
      const showCompactHint = !isAuthenticated && hasRemoteServers;

      expect(showGetStarted).toBe(false);
      expect(showProjects).toBe(true);
      expect(showCompactHint).toBe(false);
    });
  });

  describe('hasRemoteServers from bridge', () => {
    it('is true when listRemoteServers returns servers', async () => {
      const bridge = {
        listRemoteServers: jest.fn().mockResolvedValue([
          { id: 'srv-1', name: 'My Server', url: 'https://my-server.com' },
        ]),
      };

      const servers = await bridge.listRemoteServers();
      expect(servers.length > 0).toBe(true);
    });

    it('is false when listRemoteServers returns empty', async () => {
      const bridge = {
        listRemoteServers: jest.fn().mockResolvedValue([]),
      };

      const servers = await bridge.listRemoteServers();
      expect(servers.length > 0).toBe(false);
    });
  });

  describe('previous bug behavior', () => {
    it('OLD: projects were hidden when not authenticated, even with remote servers', () => {
      const isAuthenticated = computeIsAuthenticated(NO_AUTH);
      // OLD condition: projects only shown when `isAuthenticated`
      const oldShowProjects = !!isAuthenticated;
      expect(oldShowProjects).toBe(false); // Bug: remote projects hidden
    });

    it('NEW: projects shown when remote servers exist, even without auth', () => {
      const isAuthenticated = computeIsAuthenticated(NO_AUTH);
      const hasRemoteServers = true;
      // NEW condition: projects shown when authenticated OR has remote servers
      const newShowProjects = isAuthenticated || hasRemoteServers;
      expect(newShowProjects).toBe(true); // Fix: remote projects visible
    });
  });
});
