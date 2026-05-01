import { useThemeMode } from './use-theme';

export function useColorScheme() {
  return useThemeMode().resolved;
}
