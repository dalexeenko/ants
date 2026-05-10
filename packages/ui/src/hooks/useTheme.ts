import { useMemo } from 'react';
import { useUIStore } from '../store/uiStore';
import { resolveTheme } from '../styles/theme';

export function useThemeMode() {
  const themeMode = useUIStore((state) => state.themeMode);
  const setThemeMode = useUIStore((state) => state.setThemeMode);

  const theme = useMemo(() => resolveTheme(themeMode), [themeMode]);

  return {
    theme,
    themeMode,
    setThemeMode,
  };
}

// Re-export the useTheme from styles for convenience
export { useTheme } from '../styles/theme';
