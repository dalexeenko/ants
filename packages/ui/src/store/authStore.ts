import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthStatus } from '../agent/types';
import { getPersistStorage } from './persistStorage';

interface AuthState {
  status: AuthStatus;

  // Actions
  setAuthStatus: <K extends keyof AuthStatus>(
    provider: K,
    updates: Partial<AuthStatus[K]>
  ) => void;
  setFullAuthStatus: (status: AuthStatus) => void;
}

const initialAuthStatus: AuthStatus = {
  anthropic: { authenticated: false, method: null },
  openai: { hasApiKey: false },
  google: { hasApiKey: false },
  openrouter: { hasApiKey: false },
  groq: { hasApiKey: false },
  xai: { hasApiKey: false },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      status: initialAuthStatus,

      setAuthStatus: (provider, updates) =>
        set((state) => ({
          status: {
            ...state.status,
            [provider]: { ...state.status[provider], ...updates },
          },
        })),

      setFullAuthStatus: (status) => set({ status }),
    }),
    {
      name: 'openmgr-auth-store',
      storage: getPersistStorage(),
      partialize: (state) => ({ status: state.status }),
    }
  )
);

// Selectors
export const selectIsAuthenticated = (state: AuthState, provider: string) => {
  if (provider === 'anthropic') {
    return state.status.anthropic.authenticated;
  }
  const providerStatus = state.status[provider as keyof AuthStatus];
  if (providerStatus && 'hasApiKey' in providerStatus) {
    return providerStatus.hasApiKey;
  }
  return false;
};

export const selectHasAnyAuth = (state: AuthState) => {
  return (
    state.status.anthropic.authenticated ||
    state.status.openai.hasApiKey ||
    state.status.google.hasApiKey ||
    state.status.openrouter.hasApiKey ||
    state.status.groq.hasApiKey ||
    state.status.xai.hasApiKey
  );
};
