import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/locales/en.json';
import lt from '@/locales/lt.json';
import pl from '@/locales/pl.json';
import ru from '@/locales/ru.json';
import uk from '@/locales/uk.json';

import type { DriverLanguage } from '@/lib/auth-api';

// The five locales the driver app ships translations for.
export const SUPPORTED = ['en', 'uk', 'pl', 'lt', 'ru'] as const;
export type AppLocale = (typeof SUPPORTED)[number];

// Persist the last chosen UI language so it survives logout and relaunch —
// otherwise pre-login screens (phone/otp) would fall back to the device
// locale every time the user record is absent.
const STORAGE_KEY = 'app_locale';

const isSupported = (code?: string | null): code is AppLocale =>
  !!code && (SUPPORTED as readonly string[]).includes(code);

/** Map the stored `DriverLanguage` enum (UK/EN/PL/LT/RU…) to a locale code. */
export function toLocale(lang?: DriverLanguage | string | null): AppLocale {
  const code = (lang ?? '').toLowerCase();
  return isSupported(code) ? code : 'en';
}

/** Device language on first launch, when the user hasn't picked one yet. */
function deviceLocale(): AppLocale {
  const code = getLocales()[0]?.languageCode?.toLowerCase();
  return isSupported(code) ? code : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    uk: { translation: uk },
    pl: { translation: pl },
    lt: { translation: lt },
    ru: { translation: ru },
  },
  lng: deviceLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Restore the last persisted choice on top of the device-locale default.
void AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
  if (isSupported(saved) && i18n.language !== saved) {
    void i18n.changeLanguage(saved);
  }
});

/**
 * Apply a language chosen in Settings (or restored from the user record)
 * and remember it. Called with a falsy value (e.g. after logout) it is a
 * no-op, so the previously chosen language stays in effect.
 */
export function setAppLanguage(lang?: DriverLanguage | string | null) {
  if (!lang) return;
  const next = toLocale(lang);
  if (i18n.language !== next) void i18n.changeLanguage(next);
  void AsyncStorage.setItem(STORAGE_KEY, next);
}

export default i18n;
