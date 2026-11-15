import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

const STORAGE_KEY = 'theme_mode';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: ResolvedScheme;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useSystemColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Restore the saved preference on launch.
  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') setModeState(saved);
    });
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    void AsyncStorage.setItem(STORAGE_KEY, m);
  }, []);

  const resolved: ResolvedScheme =
    mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      setMode,
      toggle: () => setMode(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [mode, resolved, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Safe fallback if provider is missing — keeps tests usable.
    const system = useSystemColorScheme();
    const resolved: ResolvedScheme = system === 'dark' ? 'dark' : 'light';
    return {
      mode: 'system',
      resolved,
      setMode: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}
