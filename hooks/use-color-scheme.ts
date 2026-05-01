import { useThemeMode } from './use-theme';

/**
 * Resolved color scheme respecting the user's manual override (light/dark/system).
 * Routes through the ThemeProvider — the OS scheme is used only when mode === 'system'.
 */
export function useColorScheme() {
  return useThemeMode().resolved;
}
