/**
 * Design tokens ported from is-fleet-frontend/src/app/globals.css.
 * oklch values were converted to sRGB hex for React Native compatibility.
 * Keep names aligned with the web project so component logic stays parallel.
 */

import { Platform } from 'react-native';

const light = {
  background: '#F7F7F9',
  foreground: '#1B1F26',
  card: '#FFFFFF',
  cardForeground: '#1B1F26',
  popover: '#FFFFFF',
  popoverForeground: '#1B1F26',
  primary: '#3B6EE0',
  primaryForeground: '#FAFAFA',
  secondary: '#EFF1F5',
  secondaryForeground: '#252A33',
  muted: '#ECEEF2',
  mutedForeground: '#6B7280',
  accent: '#E08A3B',
  accentForeground: '#FAFAFA',
  destructive: '#D24A3D',
  destructiveForeground: '#FAFAFA',
  border: '#DDE0E6',
  input: '#DDE0E6',
  ring: '#3B6EE0',
  sidebar: '#F1F2F6',
  sidebarForeground: '#1B1F26',
  sidebarPrimary: '#E08A3B',
  sidebarPrimaryForeground: '#FAFAFA',
  sidebarAccent: '#E2E5EB',
  sidebarAccentForeground: '#1B1F26',
  sidebarBorder: '#D5D8DE',
  sidebarRing: '#3B6EE0',
  // Legacy keys kept for existing template components
  text: '#1B1F26',
  tint: '#3B6EE0',
  icon: '#6B7280',
  tabIconDefault: '#6B7280',
  tabIconSelected: '#3B6EE0',
};

const dark = {
  background: '#161A21',
  foreground: '#E8E9ED',
  card: '#1C2129',
  cardForeground: '#E8E9ED',
  popover: '#1C2129',
  popoverForeground: '#E8E9ED',
  primary: '#5483E5',
  primaryForeground: '#FAFAFA',
  secondary: '#252A33',
  secondaryForeground: '#E8E9ED',
  muted: '#252A33',
  mutedForeground: '#8A8F99',
  accent: '#E68C42',
  accentForeground: '#1B1F26',
  destructive: '#CE4A40',
  destructiveForeground: '#FAFAFA',
  border: '#2A2F38',
  input: '#2A2F38',
  ring: '#5483E5',
  sidebar: '#13171D',
  sidebarForeground: '#E8E9ED',
  sidebarPrimary: '#E68C42',
  sidebarPrimaryForeground: '#1B1F26',
  sidebarAccent: '#21262E',
  sidebarAccentForeground: '#E8E9ED',
  sidebarBorder: '#252A33',
  sidebarRing: '#5483E5',
  text: '#E8E9ED',
  tint: '#FFFFFF',
  icon: '#8A8F99',
  tabIconDefault: '#8A8F99',
  tabIconSelected: '#FFFFFF',
};

export const Colors = { light, dark };

export const Radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

export type ThemeColors = typeof light;
