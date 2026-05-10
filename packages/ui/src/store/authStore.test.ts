import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore, selectIsAuthenticated, selectHasAnyAuth } from './authStore';

describe('useAuthStore', () => {
  const initialAuthStatus = {
    anthropic: { authenticated: false, method: null },
    openai: { hasApiKey: false },
    google: { hasApiKey: false },
    openrouter: { hasApiKey: false },
    groq: { hasApiKey: false },
    xai: { hasApiKey: false },
  };

  beforeEach(() => {
    // Reset store state between tests
    useAuthStore.setState({
      status: initialAuthStatus,
    });
  });

  describe('setAuthStatus', () => {
    it('should update anthropic auth status', () => {
      useAuthStore.getState().setAuthStatus('anthropic', {
        authenticated: true,
        method: 'oauth',
      });
      
      const status = useAuthStore.getState().status;
      expect(status.anthropic.authenticated).toBe(true);
      expect(status.anthropic.method).toBe('oauth');
    });

    it('should update anthropic auth with api key method', () => {
      useAuthStore.getState().setAuthStatus('anthropic', {
        authenticated: true,
        method: 'apikey',
      });
      
      const status = useAuthStore.getState().status;
      expect(status.anthropic.authenticated).toBe(true);
      expect(status.anthropic.method).toBe('apikey');
    });

    it('should update openai api key status', () => {
      useAuthStore.getState().setAuthStatus('openai', {
        hasApiKey: true,
      });
      
      const status = useAuthStore.getState().status;
      expect(status.openai.hasApiKey).toBe(true);
    });

    it('should update google api key status', () => {
      useAuthStore.getState().setAuthStatus('google', {
        hasApiKey: true,
      });
      
      const status = useAuthStore.getState().status;
      expect(status.google.hasApiKey).toBe(true);
    });

    it('should update openrouter api key status', () => {
      useAuthStore.getState().setAuthStatus('openrouter', {
        hasApiKey: true,
      });
      
      const status = useAuthStore.getState().status;
      expect(status.openrouter.hasApiKey).toBe(true);
    });

    it('should update groq api key status', () => {
      useAuthStore.getState().setAuthStatus('groq', {
        hasApiKey: true,
      });
      
      const status = useAuthStore.getState().status;
      expect(status.groq.hasApiKey).toBe(true);
    });

    it('should update xai api key status', () => {
      useAuthStore.getState().setAuthStatus('xai', {
        hasApiKey: true,
      });
      
      const status = useAuthStore.getState().status;
      expect(status.xai.hasApiKey).toBe(true);
    });

    it('should preserve other providers when updating one', () => {
      useAuthStore.getState().setAuthStatus('openai', { hasApiKey: true });
      useAuthStore.getState().setAuthStatus('google', { hasApiKey: true });
      
      const status = useAuthStore.getState().status;
      expect(status.openai.hasApiKey).toBe(true);
      expect(status.google.hasApiKey).toBe(true);
      expect(status.anthropic.authenticated).toBe(false);
    });

    it('should partial update a provider status', () => {
      useAuthStore.getState().setAuthStatus('anthropic', {
        authenticated: true,
        method: 'oauth',
      });
      
      // Only update authenticated, keep method
      useAuthStore.getState().setAuthStatus('anthropic', {
        authenticated: false,
      });
      
      const status = useAuthStore.getState().status;
      expect(status.anthropic.authenticated).toBe(false);
      // method should still be 'oauth' from the merge
      expect(status.anthropic.method).toBe('oauth');
    });
  });

  describe('setFullAuthStatus', () => {
    it('should set entire auth status', () => {
      const newStatus = {
        anthropic: { authenticated: true, method: 'oauth' as const },
        openai: { hasApiKey: true },
        google: { hasApiKey: false },
        openrouter: { hasApiKey: true },
        groq: { hasApiKey: false },
        xai: { hasApiKey: true },
      };
      
      useAuthStore.getState().setFullAuthStatus(newStatus);
      
      const status = useAuthStore.getState().status;
      expect(status.anthropic.authenticated).toBe(true);
      expect(status.openai.hasApiKey).toBe(true);
      expect(status.openrouter.hasApiKey).toBe(true);
      expect(status.xai.hasApiKey).toBe(true);
    });

    it('should replace all providers', () => {
      useAuthStore.getState().setAuthStatus('openai', { hasApiKey: true });
      
      useAuthStore.getState().setFullAuthStatus(initialAuthStatus);
      
      const status = useAuthStore.getState().status;
      expect(status.openai.hasApiKey).toBe(false);
    });
  });

  describe('selectors', () => {
    describe('selectIsAuthenticated', () => {
      it('should return true for authenticated anthropic', () => {
        useAuthStore.getState().setAuthStatus('anthropic', {
          authenticated: true,
          method: 'oauth',
        });
        
        const state = useAuthStore.getState();
        expect(selectIsAuthenticated(state, 'anthropic')).toBe(true);
      });

      it('should return false for unauthenticated anthropic', () => {
        const state = useAuthStore.getState();
        expect(selectIsAuthenticated(state, 'anthropic')).toBe(false);
      });

      it('should return true for provider with API key', () => {
        useAuthStore.getState().setAuthStatus('openai', { hasApiKey: true });
        
        const state = useAuthStore.getState();
        expect(selectIsAuthenticated(state, 'openai')).toBe(true);
      });

      it('should return false for provider without API key', () => {
        const state = useAuthStore.getState();
        expect(selectIsAuthenticated(state, 'openai')).toBe(false);
      });

      it('should return false for unknown provider', () => {
        const state = useAuthStore.getState();
        expect(selectIsAuthenticated(state, 'unknown-provider')).toBe(false);
      });
    });

    describe('selectHasAnyAuth', () => {
      it('should return false when no auth configured', () => {
        const state = useAuthStore.getState();
        expect(selectHasAnyAuth(state)).toBe(false);
      });

      it('should return true when anthropic is authenticated', () => {
        useAuthStore.getState().setAuthStatus('anthropic', {
          authenticated: true,
          method: 'oauth',
        });
        
        const state = useAuthStore.getState();
        expect(selectHasAnyAuth(state)).toBe(true);
      });

      it('should return true when any provider has API key', () => {
        useAuthStore.getState().setAuthStatus('openai', { hasApiKey: true });
        
        const state = useAuthStore.getState();
        expect(selectHasAnyAuth(state)).toBe(true);
      });

      it('should return true when multiple providers are configured', () => {
        useAuthStore.getState().setAuthStatus('openai', { hasApiKey: true });
        useAuthStore.getState().setAuthStatus('google', { hasApiKey: true });
        
        const state = useAuthStore.getState();
        expect(selectHasAnyAuth(state)).toBe(true);
      });

      it('should check all providers', () => {
        // Test each provider independently
        const providers: Array<'openai' | 'google' | 'openrouter' | 'groq' | 'xai'> = [
          'openai', 'google', 'openrouter', 'groq', 'xai'
        ];
        
        for (const provider of providers) {
          // Reset
          useAuthStore.setState({ status: initialAuthStatus });
          
          // Set one provider
          useAuthStore.getState().setAuthStatus(provider, { hasApiKey: true });
          
          const state = useAuthStore.getState();
          expect(selectHasAnyAuth(state)).toBe(true);
        }
      });
    });
  });
});
